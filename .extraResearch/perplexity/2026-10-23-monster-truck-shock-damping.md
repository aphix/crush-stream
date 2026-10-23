> Question: Monster Jam nitrogen shocks on a 4-link suspension: what is the ride natural frequency (Hz) or damping ratio? What is the sprung and unsprung mass of a roughly 12,000 lb monster truck (tire, wheel, axle and planetary hubs per corner, in lb)? What spring rate or nitrogen pressure gives the static ride height?

There is **no published Monster Jam specification** for ride natural frequency, damping ratio, exact unsprung mass, or static nitrogen pressure versus ride height. The available figures support a reasonable engineering estimate, not a definitive setup value.

## Known published values

- Truck mass: commonly about **10,000 lb without tires** and roughly **12,000 lb with tires**.[3]
- Tire and wheel: **645 lb per corner**.[1][9]
- Nitrogen shocks: generally **two shocks per corner**, eight total; approximately **50 lb each**, with roughly **250–450 psi** nitrogen charge.[4][8]
- Suspension: four-link, about **30 in of travel**.[1][2]
- Tire pressure: approximately **23–25 psi**.[1][2]

## Estimated sprung and unsprung mass

A useful quarter-truck estimate is:

\[
W_\text{total}=12{,}000\ \text{lb}
\]

\[
W_\text{corner}\approx 3{,}000\ \text{lb}
\]

The tire and wheel alone account for approximately:

\[
W_{\text{tire+wheel}}=645\ \text{lb}
\]

A published technical source identifies a planetary hub as approximately **140 lb**.[5] A complete axle assembly, including differential, tubes, brakes, hubs, and associated hardware, can plausibly contribute another several hundred pounds per corner. Therefore, a practical estimate is:

| Per-corner component | Approximate mass |
|---|---:|
| Tire and wheel | 645 lb |
| Planetary hub | 140 lb |
| Share of axle/differential/brakes | 350–550 lb |
| Portion of shocks, links, and other moving hardware | 50–150 lb |
| **Estimated unsprung mass** | **1,200–1,500 lb** |
| **Estimated sprung mass** | **1,500–1,800 lb** |

For a first-order model, use approximately:

\[
W_\text{u}=1{,}350\ \text{lb}
\]

\[
W_\text{s}=1{,}650\ \text{lb}
\]

per corner. This is consistent with the industry description that a very large fraction of the truck’s mass can be unsprung.[10]

The exact split depends strongly on whether the axle center section, half shafts, brakes, shock bodies, lower links, and part of the planetary assembly are treated as moving with the wheel or with the body. The tire/wheel value is documented; the complete corner assembly is not.

## Ride natural frequency

For a vertical sprung-mass model:

\[
f_n=\frac{1}{2\pi}\sqrt{\frac{k_s}{m_s}}
\]

where \(k_s\) is the effective wheel rate and \(m_s\) is sprung mass.

Monster Jam trucks are not normally tuned like road vehicles. Their very long travel, large impacts, and nitrogen air springs imply a highly progressive rate. A defensible estimate for the **static or low-amplitude ride frequency** is approximately:

\[
\boxed{f_n\approx 1.0\text{–}1.5\ \text{Hz}}
\]

A likely nominal modeling value is:

\[
\boxed{f_n\approx 1.2\ \text{Hz}}
\]

At \(W_s=1{,}650\ \text{lb}\), \(f_n=1.2\ \text{Hz}\) requires:

\[
k_s=(2\pi f_n)^2\frac{W_s}{g}
\]

\[
\boxed{k_s\approx 9{,}200\ \text{lb/in}}
\]

Approximate effective wheel rates are therefore:

| Assumed ride frequency | Effective wheel rate |
|---:|---:|
| 1.0 Hz | 6,400 lb/in |
| 1.2 Hz | 9,200 lb/in |
| 1.5 Hz | 14,400 lb/in |

These are **combined corner rates**, not the rate of one shock. With two shocks per corner, each shock contributes approximately half the force at a given displacement only if both shocks share motion and gas characteristics equally.

## Damping ratio

A damping ratio requires measured force–velocity data:

\[
\zeta=\frac{c}{2\sqrt{k_s m_s}}
\]

The public material identifies nitrogen pressure and hydraulic fluid, but does not publish dyno curves, piston dimensions, shim stacks, bleed sizes, or rebound/compression coefficients.[2][4] Consequently, an exact damping ratio cannot be calculated from the available data.

For simulation, reasonable initial values are:

- **Low-speed ride damping:** \(\zeta\approx0.25\text{–}0.40\)
- **General off-road setup estimate:** \(\zeta\approx0.35\text{–}0.50\)
- **High-speed compression/impact equivalent:** nonlinear and not meaningfully represented by one constant ratio

Using \(f_n=1.2\ \text{Hz}\), \(m_s\approx51.3\) slugs, and \(k_s\approx110{,}000\) lbf/ft, critical damping is approximately:

\[
c_c=2\sqrt{k_s m_s}\approx4{,}750\ \text{lbf·s/ft}
\]

Thus, a nominal \(\zeta=0.35\) corresponds to:

\[
c\approx1{,}660\ \text{lbf·s/ft}
\]

or approximately:

\[
\boxed{c\approx52\ \text{lbf·s/in}}
\]

for the combined two-shock corner, as a linearized small-amplitude equivalent. Actual shock damping will be strongly velocity-dependent and asymmetric between compression and rebound.

## Spring rate and nitrogen pressure for static ride height

Nitrogen pressure alone cannot determine static ride height without the shock’s:

- piston area,
- floating-piston area,
- gas-volume dimensions,
- installed length,
- motion ratio,
- shock angle,
- pressure at the target extension,
- and any bump-stop contribution.

A simplified gas-spring relation is:

\[
F_g(x)=A_pP_0
\left(\frac{V_0}{V_0-A_px}\right)^n
\]

where \(A_p\) is effective gas piston area, \(P_0\) is initial pressure, \(V_0\) is gas volume, and \(n\) is the gas-process exponent. Because the gas force is progressive, the “spring rate” changes with position.

For a target static ride height, the correct force condition is:

\[
\sum_i F_{\text{shock},i}(x)
+\sum_i F_{\text{tire},i}(x)
=
W_s
\]

At one corner, using the estimated sprung load:

\[
\boxed{W_s\approx1{,}650\ \text{lb per corner}}
\]

If the two shocks share load equally, each must provide roughly:

\[
\boxed{825\ \text{lb of static spring force per shock}}
\]

after accounting for tire compliance, link motion ratio, shock angle, and any chassis load transfer.

A useful preliminary target is therefore:

- **Combined corner static spring force:** about **1,500–1,800 lb**
- **Per shock static force:** about **750–900 lb**
- **Combined low-speed wheel rate:** about **6,000–14,000 lb/in**, depending on the desired 1.0–1.5 Hz ride frequency
- **Nitrogen pressure:** likely within the published **250–450 psi** range, but pressure must be selected from measured shock force-versus-position data rather than inferred from truck weight.[4]

The published charge range should not be interpreted as a ride-height specification. Two shocks at the same nitrogen pressure can produce very different static forces if their gas volumes or piston areas differ. For a credible setup, measure each shock’s force at the installed static length, include the actual four-link motion ratio, and adjust pressure until the combined force at the target position equals the corner sprung load.

[1] Monster Jam 101 | Monster Jam® (https://www.monsterjam.com/en-us/monster-jam-101/)
[2] The Main Event (https://www.motortrend.com/features/what-is-monster-jam-all-about-monster-truck-racing)
[3] Monster Trucks are 12,000lbs and 1,400hp Worth of Insanity. How Son-uva Digger Works! (https://www.youtube.com/watch?v=QgeCCTayQBg)
[4] MONSTER SHOCKS (https://www.monsterjam.com/wp-content/uploads/2023/12/Monster-Jam-Monster-Shocks-ENGLISH.pdf)
[5] Monster Jam Race Shop Ep 2: Axle (https://www.youtube.com/watch?v=EPcmibc4H80&vl=de)
[6] Monster Jam at Moda Center (https://www.modaportland.com/events/monster-jam-01-march-2024/)
[7] JCB and Monster Jam (https://vertikal.net/en/news/story/44244/jcb-and-monster-jam)
[8] The Evolution of Monster Jam Trucks (https://d21buns5ku92am.cloudfront.net/45993/documents/26501-MonsterJam_PressKit-e21cbf.pdf)
[9] MONSTER JAM FACTS (https://www.monsterjam.com/wp-content/uploads/2023/12/Monster-Jam-Truck-Body-Facts-ENGLISH.pdf)
[10] Building a Monster Truck (Part 2) – Axles, Shocks & Suspension Explained (https://www.youtube.com/watch?v=qHzxtAzIf4w&vl=it)
