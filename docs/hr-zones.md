# Heart rate zones: foundations and limits

Update, 2026-11-06: the [training science foundation](research/2026-11-06-training-science-foundation.md) adds the distinction between measured thresholds, estimated anchors and display zones. The current settings below remain a description of the implementation; no new physiological zone calibration has been implemented.

As of 2026-11-01, from a short search through summaries; I did not read the full texts.

## What the sources support

- **Estimating maximum heart rate is imprecise.** Tanaka et al. 2001: 208 − 0.7 × age, standard error around 10 beats. In another sample of 762 adults 11.4 beats; the formulas do not hit the individual accurately. Therefore: your own value takes priority, and the estimate is shown as such. https://webs.um.es/jlyuste/documts/tanaka.pdf https://researchportal.bath.ac.uk/en/publications/measured-maximal-heart-rates-compared-to-commonly-used-age-based-/
- **Zones by percentage of maximum heart rate are common but crude.** They are widely used in fitness devices; one review puts the first threshold at around 60–70% and the second at around 80–90%. Where the thresholds actually lie varies greatly from person to person and with training status. The zones do not replace an accurate measurement. https://pmc.ncbi.nlm.nih.gov/articles/PMC8362801
- **Heart rate rises over time at constant power.** Less so in the well trained. Heat, dehydration and fatigue contribute, so the value is not a pure measure of fitness. https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1623384/pdf

## Own settings, not evidenced

- Five zones from 50 to 100% in steps of ten.
- Mapping of power to zone (up to 55% FTP zone 2, up to 75% zone 3, up to 90% zone 4, above that zone 5).
- Control only in segments for which the coach has set a zone: only after 3 minutes in the segment, because heart rate lags, then 60 s above the zone, then 5% less power, at most 20%.
- Rise at constant power: only segments of 10 minutes or more, excluding the first 2 minutes. Common coaching thresholds of around 5% come from blogs and forums and are deliberately not used as a limit here.
- Recovery: heart rate drop in the minute after segments of 80% FTP or more. I found no solid source for this; the value is only a comparison with yourself.

## Riding by heart rate

Only in sections marked for it (`hrHold`), currently the session "Puls halten". All of these values are our own settings, not evidenced:

- No change in the first 3 minutes of the section, because heart rate lags.
- 30 s below the zone: 2% more power. 30 s above the zone: 3% less. Inside the zone nothing changes.
- At most 15% above the starting power and never above 80% of FTP, at most 40% below the start.
- Once the personal heart rate limit has lowered the target, the power no longer rises in this section.
- Without a heart rate signal or a known maximum heart rate the power stays where it is.

In every other section heart rate only lowers the target, it never raises it. The coach can plan such sections for easy rides (`hrHold`), but only on erg sections of at least 10 minutes, at most 70% of FTP and zones 1 to 3 (own settings, `HOLD` in `src/coach/session-limits.ts`). A hold that does not fit is dropped and the section runs by power. Without a heart rate belt the app rides by power.
