from autoweave_web.services.context import derive_context_summary


def test_derive_context_summary_extracts_references_and_decision_signal():
    summary, references = derive_context_summary(
        "@ERGO decide whether to use src/app.tsx or docs/plan.md and review #42 at https://github.com/example/repo/pull/42"
    )

    assert summary.startswith("@ERGO decide whether to use")
    assert references["files"] == ["docs/plan.md", "src/app.tsx"]
    assert references["numbers"] == ["42"]
    assert references["mentions"] == ["ERGO"]
    assert references["urls"] == ["https://github.com/example/repo/pull/42"]
    assert references["has_decision_signal"] is True
