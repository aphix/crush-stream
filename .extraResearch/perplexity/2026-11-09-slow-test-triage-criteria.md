> Question: How do software projects with long-running simulation or physics tests decide which tests run on every commit and which run less often, and what results have they reported from that split? Cite sources.

Projects generally use a **tiered test strategy** rather than running every simulation on every commit:

- **Every commit:** Run fast, deterministic tests covering core logic, changed code, basic numerical invariants, and a small representative simulation set. Historical failures and fast tests are often prioritized because combining recent-failure history with short execution time finds faults earliest.[4]
- **Change- or dependency-triggered:** Select simulations whose code, data, solver, model, or dependencies were affected. Regression-test-selection research finds that changes often touch a small portion of the codebase; for commits arriving less than 10 minutes apart, only about 8.6% of source files changed on average.[5]
- **Scheduled or batched:** Run expensive full-system, long-horizon, high-resolution, cross-platform, performance, and statistical-accuracy tests periodically, overnight, or after several commits have accumulated. Google’s TAP system bundles consecutive changes into “milestones” and runs affected targets together because some targets take hours or millions of test executions.[8]
- **Release and pre-merge gates:** Reserve the broadest and most expensive suites for release candidates, major solver changes, infrastructure changes, or selected pre-merge checks. The practical rule is to run a test continuously only when its feedback value justifies its cost; otherwise, use history, dependency impact, risk, and available compute to schedule it.

## Reported results

- **Less wasted developer time:** In one continuous-testing case study, changing test frequency reduced wasted time by 31–82%; continuous testing combined with prioritization reduced wasted time by 80% in a Perl project and by more than 97% in a Java dataset.[9]
- **Regression selection is not always worthwhile:** A study of continuous-integration projects found that 60% of commits were separated by more than 10 minutes, meaning a complete test run could finish before the next commit in many cases. In 62.2% of Java projects, average test time was no more than 25% of the average commit interval, so selection was needed only during some periods.[5]
- **Batched execution cuts infrastructure demand:** Research on CI batching reported up to 75% fewer test executions with fixed-size batching, up to 99% fewer with “batch all,” and up to 72–91% fewer machines while maintaining the measured average feedback time.[2]
- **Risk-aware batching improves the trade-off:** A newer evaluation reported 32.4% fewer test executions, 3.8% lower mean feedback time, and 26.2% lower maximum time to identify a culprit, while keeping mean culprit-identification time approximately at baseline.[3]
- **Prioritization improves early feedback:** On long-running suites, prioritizing fast tests that failed recently performed best among evaluated approaches, with the leading strategies achieving mean cost-aware fault-detection scores around 0.74.[4]

The common design is therefore **fast and high-signal tests on every commit, targeted tests when dependencies or risk indicate them, and expensive full simulations in scheduled or commit-batched runs**. The reported gains are lower queue and compute costs, faster first feedback, and less developer waiting—provided that the project preserves periodic full-suite coverage to catch interactions that selective tests miss.

[1] [PDF] The Energy Impact of Batch Testing in Continuous Integration (https://carolin-brandt.de/publications/oszko-devopssustain26.pdf)
[2] [2308.13129] Accelerating Continuous Integration with ... - ar5iv (https://ar5iv.labs.arxiv.org/html/2308.13129)
[3] Risk-Aware Batch Testing for Performance Regression Detection (https://arxiv.org/html/2604.00222v1)
[4] Revisiting Test-Case Prioritization on Long-Running Test Suites (https://dl.acm.org/doi/pdf/10.1145/3650212.3680307)
[5] A Study of Regression Test Selection in Continuous ... (https://par.nsf.gov/servlets/purl/10089488)
[6] A survey of flaky tests (https://eprints.whiterose.ac.uk/id/eprint/230095/1/parry2021.pdf)
[7] Selective Bisection Debugging - Springer (https://link.springer.com/content/pdf/10.1007/978-3-662-54494-5_4.pdf?error=cookies_not_supported&code=41c6814c-722b-4b41-af26-fdaf4e54ff82)
[8] [PDF] Taming Google-Scale Continuous Testing (https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45861.pdf)
[9] Reducing wasted development time via continuous testing (https://homes.cs.washington.edu/~mernst/pubs/wasted-time-issre2003.pdf)
[10] [PDF] Assessing Transition-based Test Selection Algorithms at Google (https://mpapad.github.io/publications/pdfs/ICSE-SEIP2019.pdf)
