# Teacher feedback results

Requested 8 October 2026: replace the plain View results summary with animated graphs and actionable analytics, preserving the existing theme and confidentiality model.

## Principal decisions supported

| Question | What the results show | Measurement rule |
| --- | --- | --- |
| Has anyone responded? | Response total and cumulative daily response chart | One submitted account response; school-local dates; exact counts in a disclosure |
| Can I interpret the ratings yet? | Collecting / closed state and minimum-response explanation | Ratings unlock only after closing with five responses; each parameter needs five non-abstaining ratings |
| What is working? | Strength count, named strengths and recognition suggestions | At least 70% High among rated answers for that parameter |
| Where should I offer support? | Discussion count and contextual next-step suggestions | At least 40% Low; ordered by Low share; prompts are rules, not AI diagnosis |
| What do people actually think? | Animated donut and labelled parameter distribution bars | High / Okay / Low; Not sure reported separately and excluded from percentages; no star score |
| How much evidence supports this? | Rated counts, Not sure counts, expandable exact distributions | Hidden parameters contribute nothing to the donut, signals or trends |
| Is feedback changing? | High-share line chart and percentage-point difference | Same institution, teacher, class, audience and exact question set; order of questions may differ |

The historical query considers the six most recent comparable closed rounds no later than the selected round. A round is omitted unless every parameter passes the five-rating threshold. If the current round has any hidden parameter, no historical trend is returned. Respondents can differ between rounds, so trend copy makes no causal or performance claim. Percentages are rounded for display and can sum to 99% or 101%.

The donut counts **rated answers across published parameters, not people**. A participant can supply multiple answers. The dashboard does not show a response-rate percentage because the current schema does not snapshot an invited audience; dividing by current enrollment would misrepresent past participation.

## Workflow and interaction

- The existing View results button opens the dashboard inside its request card; no navigation or shell redesign.
- While a request is open, only collection status and response counts/activity appear, refreshed every 30 seconds. Closure invalidates results through the existing query cache.
- Sort parameter charts by question order, most Low, or most High; open a parameter for counts. Suppressed parameters always sort last in rating-based orders.
- Native disclosures and select controls support keyboard navigation. SVGs have text alternatives; exact chart data is available as HTML.
- Donut, bars and line animate once on entry. Reduced-motion preference removes animations. No looping celebratory animation or teacher rankings.
- Empty, all-Not-sure, partially suppressed, closed-insufficient, loading and retry states are explicit.
- Support suggestions remain advisory. No messages, disciplinary records or tasks are automatically created.

## Demo exception — explicit user decision

The user requested charts after one submission for the demo account, keeping five for regular accounts. When `DEMO_MODE` is enabled, only the seeded Cambridge (`cis`) principal/admin identities (matching both username and example.test email) receive `demo_preview: true` and a one-rating threshold. They may view current open results. The dashboard labels these as a small demonstration sample. All-Not-sure parameters remain hidden; historical comparisons still use closed rounds. Ordinary administrators, other institutions and demo-disabled environments retain the closed/five gates. Production configuration already rejects DEMO_MODE.

## Boundaries

Uses the existing principal-administrator authorization, tenant selection and confidential response API. Student, parent and teacher accounts do not gain results access. The API returns no respondent identity or individual answer. No schema migration, new dependency, production data seeding, free-text collection or change to the response slider.

## Validation

Targeted frontend tests cover aggregate denominators, suppressed data, locked results, sorting/disclosures, historical sample counts, percentage-point changes, empty and retry states. Backend integration coverage checks comparable question sets in a different order, exclusions for teacher/class/audience/questions, open/future rounds, all-Not-sure and partial suppression. CI runs these against a fresh isolated PostgreSQL database.

Visual review and browser verification use synthetic API fixtures, not real school responses. Stage deployment and physical-phone acceptance are separate release gates.
