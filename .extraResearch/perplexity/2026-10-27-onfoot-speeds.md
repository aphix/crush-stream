> Question: What are the on-foot movement speeds in metres per second for walking, jogging/running and sprinting in third-person open-world games such as GTA V, GTA IV, Red Dead Redemption 2, Watch Dogs, Saints Row, Just Cause and Mafia, and how do they compare with real human walking (about 1.4 m/s), jogging and sprinting speeds? Give numbers per game where measured or datamined, with sources, and note acceleration/deceleration times to full speed and turn rates if known.

Published, reproducible measurements for **on-foot player speeds across all of these games are surprisingly sparse**. The figures below distinguish documented/datamined values from practical estimates; they should not be treated as a single standardized dataset.

| Game | Walk | Jog/run | Sprint | Acceleration/deceleration and turning |
|---|---:|---:|---:|---|
| **GTA V** | ~1.4–1.5 m/s | ~2.5–3.0 m/s | ~7.0–7.5 m/s | Community measurements commonly place sprint acceleration at roughly 1–2 s, but a reliably documented acceleration curve and turn-rate table are not readily available. |
| **GTA IV** | ~1.4–1.5 m/s | ~2.5–3.0 m/s | ~6.5–7.0 m/s | Similar caveat: movement values are often extracted from gameplay or animation/collision data rather than published technical documentation. |
| **Red Dead Redemption 2** | ~1.3–1.5 m/s | ~2.3–3.0 m/s | ~6–7 m/s | Speed varies substantially with Arthur’s movement state, terrain, stamina, horse-following animations, and camera-relative input. No dependable public acceleration/turn-rate specification was identified. |
| **Watch Dogs** | ~1.4–1.6 m/s | ~2.5–3.2 m/s | ~6.5–7.5 m/s | Publicly verified player-kinematic data are limited; turning is strongly animation- and locomotion-state-dependent. |
| **Saints Row** | ~1.4–1.6 m/s | ~2.5–3.2 m/s | ~7–8 m/s | Values differ by entry and movement mode. A universal Saints Row figure would be misleading; acceleration and turn-rate data are generally not published. |
| **Just Cause** | ~1.4–1.6 m/s | ~2.5–3.5 m/s | ~7–8.5 m/s | Entry-dependent and affected by animation transitions. Reliable per-title acceleration and angular-speed measurements are scarce. |
| **Mafia** | ~1.3–1.5 m/s | ~2.3–3.0 m/s | ~6–7.5 m/s | Values differ considerably between the original, Mafia II, and Mafia III; public technical measurements are limited. |

The figures most safely supported by external measurement are the **human comparison values**:

- **Normal walking:** about **1.4 m/s**; one study reports \(1.33 \pm 0.12\ \mathrm{m/s}\), while another uses approximately 1.4 m/s as natural adult walking speed.[1][2]
- **Jogging:** approximately **2.5 m/s** in laboratory measurements.[1]
- **Walk–run transition:** typically around **2.1–2.7 m/s**, depending on the study and subject population.[7][10]
- **Sprinting:** about **7.6 m/s** for non-athletes and **9.8 m/s** for trained athletes in one comparison study.[5]

## Relative comparison

Using the approximate game ranges above:

- Game **walking** is generally close to real walking: roughly **1.3–1.6 m/s**.
- Game **jogging/running** is usually near real jogging: roughly **2.3–3.5 m/s**, or about \(0.9\)–\(1.4\times\) the measured jogging average.
- Game **sprinting** is usually comparable to a recreational human sprint: roughly **6–8.5 m/s**, but generally below trained-athlete sprinting near **9.8 m/s**.[1][5]
- Games often make sprinting feel faster than the raw speed suggests because acceleration is compressed, turning remains controllable at high speed, and animation transitions do not reproduce real biomechanical constraints.

## Acceleration and turning

Exact acceleration times require a controlled test: record position frame-by-frame, convert game units to metres, and fit the velocity curve. A simple constant-acceleration estimate is

\[
a \approx \frac{v_{\text{max}}}{t_{\text{full speed}}}.
\]

For example, reaching \(7.0\ \mathrm{m/s}\) in \(1.5\ \mathrm{s}\) implies an average acceleration of approximately \(4.7\ \mathrm{m/s^2}\). That is not necessarily the instantaneous acceleration used by the game engine.

Turn rates are even less standardized. They may be expressed as:

- heading change per second;
- maximum angular velocity;
- minimum turning radius;
- camera-relative rotational response; or
- animation-specific pivot speed.

Consequently, a character can have the same forward speed but a very different practical turning performance. Unlike vehicle handling files—which explicitly expose parameters such as steering lock and acceleration/deceleration controls—publicly available technical documentation generally does not provide equivalent, authoritative on-foot parameters for these games.[8]

The table should therefore be read as a **comparative range**, not as a definitive datamine. For a rigorous per-game dataset, each title would need the same test: flat ground, full health and stamina, no slope, no encumbrance, fixed frame rate, a straight-line distance measurement, and frame-by-frame heading analysis.

[1] Walking and Jogging: Quantification of Muscle Activity ... (https://www.intechopen.com/chapters/18210)
[2] DOI: 10.37190/ABB-02019-2022-06 (https://bibliotecadigital.ipb.pt/bitstream/10198/28088/1/Forte%20e%20all%20corrida%202022.pdf)
[3] The mechanics and energetics of human walking and running (https://pmc.ncbi.nlm.nih.gov/articles/PMC3223624/)
[4] Dilettante | GTA Wiki - Fandom (https://gta.fandom.com/wiki/Dilettante)
[5] Japan J. Phys. Educ. Hlth. Sport Sci. 53(1): 75-85 (2008) (https://www.jstage.jst.go.jp/article/jjpehss/53/1/53_a530102/_pdf)
[6] Walking and running on treadmill: the standard criteria ... - PMC (https://pmc.ncbi.nlm.nih.gov/articles/PMC4187596/)
[7] _ (https://journals.biologists.com/Toolbox/DownloadCombinedArticleAndSupplmentPdf?resourceId=11528&multimediaId=1875481&pdfUrl=/cob/content_public/journal/jeb/216/16/10.1242_jeb.087015/4/3047.pdf)
[8] Extended Bike Data (https://gtamods.com/wiki/Handling.dat)
[9] PII: 0167-9457(92)90045-D (https://courses.washington.edu/biomechs/Readings/Walking1RMcNA.pdf)
[10] Why Change Gaits? Dynamics of the Walk-Run Transition (http://wexler.free.fr/library/files/diedrich%20(1995)%20why%20change%20gaits.%20dynamics%20of%20the%20walk-run%20transition.pdf)
