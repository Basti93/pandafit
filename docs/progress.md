# Progress, best values and time on target

All of these thresholds are our own settings, not evidenced.

## Comparison with yourself

After a ride and in the history, the app looks for your most recent earlier ride of the same character and states one fact, for example "same power, 4 bpm fewer".

- Comparable: both finished, both with power and heart rate, few measurement errors, duration within 20%, and a difference in evenness (normalized power / average power) of at most 0.05.
- Average power within 5%: heart rate is compared. A difference below 2 bpm counts as the same.
- Average power 5 to 20% higher with heart rate within 2 bpm: "more power at the same heart rate".
- Anything else: no statement.

A single comparison is not proof of fitness. Sleep, heat and the form of the day also move the heart rate, see [`hr-zones.md`](hr-zones.md), which is why a higher value is only stated neutrally.

## Time on target

Share of the ridden seconds within 10% of your own target. Pauses, lost power signals and the first 15 s after a section change do not count. It appears only in your own history. Because the trainer holds the power it is usually high and mainly shows interruptions and breaking down in hard sections, so it is not compared between riders.

## Training load

Fitness and fatigue are exponential averages of TSS over 42 and 7 days, form is the difference. TSS is computed from your FTP, so an inaccurate FTP shifts all three.

## Ende des Rampentests

The ramp test ends by itself when you cannot keep up. Own settings: from minute 8 of the ride (5 minutes of warmup plus 3 minutes of ramp), 15 seconds in a row of measured power below 80% of the target end the test. Seconds without a power signal do not count, a dropout must not end the test with a wrong FTP. The ride is saved as finished. Your FTP comes from the best minute as before. A pause you set in the app never counts, because the ride does not tick then.
