use crate::{clip_to_width, redraw_frame};

#[test]
fn local_since_is_epoch_millis_for_both_branches() {
    // `--since` must come back in the unit the record timestamps parse to (ms,
    // pinned by core's `parseIso` vectors) and `--days` must convert to it too:
    // an old seconds bound made the days filter a silent no-op (ms >= seconds).
    assert_eq!(
        crate::local_since(Some("2026-09-27T12:23:00.000Z"), None),
        Some(1_790_511_780_000.0)
    );
    let day_ago = crate::local_since(None, Some(1)).expect("days bound");
    assert!(day_ago > 1.0e12, "must be ms, not seconds: {day_ago}");
    assert!(crate::local_since(None, None).is_none());
}

#[test]
fn redraw_grow_rewrites_from_old_top() {
    let mut buf: Vec<u8> = Vec::new();
    // prev = 5 (error frame), new = 14 (full frame)
    let frame = (0..14)
        .map(|i| format!("line{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let n = redraw_frame(&mut buf, &frame, 5, None);
    assert_eq!(n, 14);
    let s = String::from_utf8(buf).unwrap();
    assert!(
        s.starts_with("\x1b[4F"),
        "must move up prev-1 to old top: {s:?}"
    );
    assert_eq!(s.matches("line13").count(), 1);
    assert!(!s.contains("\x1b[1B"), "no shrink needed: {s:?}");
}

#[test]
fn redraw_shrink_clears_stale_rows_and_returns_to_new_bottom() {
    let mut buf: Vec<u8> = Vec::new();
    // prev = 14 (full frame), new = 5 (error frame): the bug case that
    // stair-stepped the screen. Old bug: each \x1b[2K\r\n pad cleared the
    // freshly-written status row and \x1b[1F landed prev-n-1 rows short.
    let frame = (0..5)
        .map(|i| format!("line{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let n = redraw_frame(&mut buf, &frame, 14, None);
    assert_eq!(n, 5);
    let s = String::from_utf8(buf).unwrap();
    // move up 13 to old top, draw 5 lines
    assert!(s.starts_with("\x1b[13F"), "must move up prev-1: {s:?}");
    assert_eq!(s.matches("\n").count(), 4, "exactly n-1 line feeds: {s:?}");
    // shrink: down one (status survives), clear 8 stale rows, clear old
    // bottom, then up (prev-n) = 9 back to the new bottom.
    let shrink = s.split("line4").nth(1).unwrap();
    assert!(
        shrink.starts_with("\x1b[1B"),
        "down past frame, no clear: {shrink:?}"
    );
    assert_eq!(
        shrink.matches("\x1b[2K\x1b[1B").count(),
        8,
        "stale rows: {shrink:?}"
    );
    assert!(
        shrink.ends_with("\x1b[2K\x1b[9F"),
        "clear old bottom + up prev-n: {shrink:?}"
    );
}

#[test]
fn redraw_no_previous_frame_just_draws() {
    let mut buf: Vec<u8> = Vec::new();
    let n = redraw_frame(&mut buf, "a\nb", 0, None);
    assert_eq!(n, 2);
    let s = String::from_utf8(buf).unwrap();
    assert_eq!(
        s, "\x1b[2K\ra\n\x1b[2K\rb",
        "no up-move on first frame, no trailing nl: {s:?}"
    );
}

#[test]
fn clip_no_wrap_preserves_short_lines() {
    assert_eq!(clip_to_width("abc", Some(10)), "abc");
    assert_eq!(clip_to_width("abc", None), "abc");
}

#[test]
fn clip_trims_to_terminal_width_and_resets() {
    // 20 glyphs into an 12-col terminal → first 12 kept, no raw overflow.
    let out = clip_to_width("█".repeat(20).as_str(), Some(12));
    assert_eq!(out.chars().filter(|c| *c == '█').count(), 12);
    assert!(out.ends_with("\x1b[0m"));
}

#[test]
fn clip_counts_visible_ignoring_color_codes() {
    let styled = format!("\x1b[32m{}\x1b[0m", "x".repeat(30));
    let out = clip_to_width(&styled, Some(10));
    assert_eq!(out.chars().filter(|c| *c == 'x').count(), 10);
    assert!(out.ends_with("\x1b[0m"));
}

#[test]
fn clip_treats_carriage_return_as_zero_width() {
    let out = clip_to_width("\r\x1b[2Kxx", Some(2));
    assert_eq!(out.matches('x').count(), 2);
}

#[test]
fn clip_keeps_leading_carriage_return_when_truncated() {
    // countdown bug: truncating dropped the \r, so each rewrite appended at
    // the current column instead of returning to col 0 → thin terminals got a
    // fresh duplicate "refreshing every…" per tick.
    let msg = "\r\x1b[2Krefreshing every 2s · next refresh in 1s · ctrl-c to quit";
    let out = clip_to_width(msg, Some(20));
    assert_eq!(
        out, "\r\x1b[2Krefreshing every 2s \x1b[0m",
        "CR kept + clipped: {out:?}"
    );
}

#[test]
fn watch_lines_wrap_instead_of_cutting() {
    // The 110-character allowance note at a 40-column terminal: three lines,
    // every word kept, no ellipsis. The old clip_to_width dropped the tail.
    let text = "the allowance changed during this period from $55 to $70 for deepseek because the plan limit moved again today";
    assert_eq!(text.chars().count(), 110);
    let lines = crate::wrap_line(text, Some(40));
    assert_eq!(lines.len(), 3, "wrapped lines: {lines:?}");
    assert_eq!(lines.join(" "), text, "no character lost");
    assert!(!lines.join(" ").contains('…'));
    assert!(
        lines.iter().all(|l| crate::visible_columns(l) <= 40),
        "a wrapped row must fit: {lines:?}"
    );
}

#[test]
fn a_line_that_fits_is_byte_identical() {
    let line = "  Monthly  $70.15 / $100 · 70.1% used";
    assert_eq!(crate::wrap_line(line, Some(120)), vec![line.to_string()]);
    assert_eq!(crate::wrap_line(line, None), vec![line.to_string()]);
}

#[test]
fn width_comes_from_the_terminal_then_columns_then_100() {
    assert_eq!(crate::resolve_width(Some(40), Some(80), Some(60)), 40);
    assert_eq!(crate::resolve_width(None, Some(80), Some(60)), 80);
    assert_eq!(crate::resolve_width(None, None, Some(60)), 60);
    assert_eq!(crate::resolve_width(None, None, None), 100);
    // a zero/absent answer is not a width; it must fall through
    assert_eq!(crate::resolve_width(None, Some(0), Some(60)), 60);
}

#[test]
fn json_and_csv_ignore_width() {
    let mut args = crate::cli::Args {
        width: Some(40),
        ..Default::default()
    };
    assert_eq!(crate::watch_width(&args, Some(80)), Some(40));
    args.json = true;
    assert_eq!(crate::watch_width(&args, Some(80)), None);
    args.json = false;
    args.csv = true;
    assert_eq!(crate::watch_width(&args, Some(80)), None);
}

#[test]
fn wrapped_lines_keep_the_margin_and_colour() {
    let text = "the allowance changed during this period from $55 to $70 for deepseek because the plan limit moved again today";
    let line = format!("  \x1b[2m{text}\x1b[0m");
    let lines = crate::wrap_line(&line, Some(40));
    assert!(lines.len() > 1, "must wrap: {lines:?}");
    for wrapped in &lines {
        assert!(
            wrapped.starts_with("  \x1b[2m"),
            "margin + dim reopened: {wrapped:?}"
        );
    }
    assert!(
        lines[..lines.len() - 1]
            .iter()
            .all(|l| l.ends_with("\x1b[0m")),
        "each wrapped row closes its colour: {lines:?}"
    );
    let last = lines.last().unwrap();
    assert!(last.contains("today"), "tail word survived: {last:?}");
}

#[test]
fn redraw_wraps_a_long_frame_line_without_losing_words() {
    let mut buf = Vec::new();
    let frame = format!("short\n{}", "word ".repeat(30));
    let n = redraw_frame(&mut buf, &frame, 0, Some(40));
    assert!(n > 2, "long line must become several rows: {n}");
    let out = String::from_utf8(buf).unwrap();
    assert!(!out.contains('…'));
    assert_eq!(out.matches("word").count(), 30, "every word drawn once");
}

#[test]
fn one_shot_prose_wraps_but_table_rows_do_not() {
    let table = "  Model                              Reqs     Tokens       Cost";
    let prose =
        "Monthly: 74.2% ($51.94 / $70.00) · resets in 11d 18h · on pace to hit cap in 6d 8h";
    let text = format!("{prose}\n{table}\n");
    let out = crate::wrap_text(&text, Some(40));
    assert!(
        out.contains(table),
        "table row left byte-identical: {out:?}"
    );
    assert!(
        out.lines().count() > 2,
        "prose became several rows: {out:?}"
    );
    for line in out.lines() {
        if line != table {
            assert!(
                crate::visible_columns(line) <= 40,
                "wrapped row fits: {line:?}"
            );
        }
    }
    assert!(out.ends_with('\n'), "trailing newline preserved");
    assert_eq!(crate::wrap_text(&text, None), text, "no width: unchanged");
}

#[test]
fn margin_counts_against_the_wrap_budget() {
    // The two-space indent is part of the width, not extra: every wrapped row
    // stays within the byte budget INCLUDING its margin.
    let line = format!("  {}", "word ".repeat(20));
    let lines = crate::wrap_line(&line, Some(40));
    assert!(lines.len() > 1);
    for wrapped in &lines {
        assert!(wrapped.starts_with("  "), "margin kept: {wrapped:?}");
        assert!(wrapped.len() <= 40, "margin inside budget: {wrapped:?}");
    }
}

#[test]
fn multibyte_glyphs_are_budgeted_in_bytes() {
    // `·` is two bytes: awk length counts 41 for a 40-character row. The wrap
    // budget is bytes so byte-counting scripts and the flag agree.
    let line = format!(
        "period: {} · 73.9K requests · $70.63 · 267.9M in",
        "2026-12-13"
    );
    let lines = crate::wrap_line(&line, Some(40));
    for wrapped in &lines {
        assert!(wrapped.len() <= 40, "byte budget: {wrapped:?}");
        assert!(
            crate::visible_columns(wrapped) <= 40,
            "column budget: {wrapped:?}"
        );
    }
}

#[test]
fn one_shot_width_matches_watch_resolution() {
    // Both paths call the same frame_width; explicit wins, machine formats bypass.
    let mut args = crate::cli::Args {
        width: Some(40),
        ..Default::default()
    };
    assert_eq!(crate::one_shot_width(&args), Some(40));
    args.json = true;
    assert_eq!(crate::one_shot_width(&args), None);
}

#[test]
fn mcp_missing_method_with_id_is_error() {
    use serde_json::json;
    let msg = json!({"jsonrpc":"2.0","id":1});
    let resp = crate::mcp::handle(&msg).expect("error reply");
    assert_eq!(resp["error"]["code"], -32600);
    let msg2 = json!({"jsonrpc":"2.0"});
    assert!(crate::mcp::handle(&msg2).is_none());
}
