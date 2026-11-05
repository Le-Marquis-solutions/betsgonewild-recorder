# Bets Gone Wild — Recorder

Screen-recording factory for the Bets Gone Wild YouTube channel.
Drop a JSON file in `requests/` (`{"url": "...", "slug": "..."}`) and push:
the GitHub Actions workflow opens the page with Playwright, records a slow,
read-only navigation video, and commits `recordings/<slug>.webm` (+ a `.png` poster).
