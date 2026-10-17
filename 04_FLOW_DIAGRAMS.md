# THATCAMPUS — Flow Diagrams

**Document:** 04_FLOW_DIAGRAMS.md  
**Format:** Mermaid  
**Purpose:** Product and technical flows for Web + Android + iOS

> These diagrams describe the proposed production system. They are intentionally higher level than individual UI screens.

---

## 1. Overall product flow

```mermaid
flowchart TD
    START[Open THATCAMPUS]

    START --> PUB{Authenticated?}
    PUB -- No --> WEBSITE[Public School Website]
    WEBSITE --> HOME[Home / Academics / Admissions / Fees / News]
    WEBSITE --> LOGIN[Login]
    WEBSITE --> ENQUIRY[Admissions Enquiry]
    ENQUIRY --> ADMISSION_API[Create Admissions Lead]

    LOGIN --> AUTH[Identity Verification]
    AUTH --> BOOT[Load Tenant + Role + Permission Manifest]

    BOOT --> ROLE{Resolved experience}

    ROLE --> STAFF[Staff / Admin]
    ROLE --> PARENT[Parent]
    ROLE --> STUDENT[Student]

    STAFF --> STAFFNAV[Authorized Staff Tools]
    PARENT --> PARENTNAV[Linked-child Tools]
    STUDENT --> STUDENTNAV[Self-scoped Tools]

    STAFFNAV --> DOMAIN[School Domain APIs]
    PARENTNAV --> DOMAIN
    STUDENTNAV --> DOMAIN

    DOMAIN --> DATA[(Authoritative School Data)]

    STAFFNAV --> AI[AI Assistant]
    PARENTNAV --> AI
    STUDENTNAV --> AI

    AI --> POLICY[Permission + AI Policy]
    POLICY --> DOMAIN
```

---

## 2. Permission-driven mobile navigation

```mermaid
flowchart TD
    LOGIN[User authenticated] --> CLAIMS[Identity + school memberships]
    CLAIMS --> AUTHZ[Authorization service]
    AUTHZ --> MANIFEST[Capability manifest]

    MANIFEST --> SORT[Rank enabled capabilities]
    SORT --> PRIMARY[Choose primary mobile destinations]
    SORT --> MORE[Remaining authorized tools]

    PRIMARY --> BOTTOM[Bottom navigation - max 5]
    MORE --> MORESCREEN[More / All tools]

    BOTTOM --> OPEN[Open capability]
    MORESCREEN --> OPEN

    OPEN --> API[API request with user context]
    API --> CHECK[Server permission check]
    CHECK -- Allowed --> DATA[Return scoped data]
    CHECK -- Denied --> DENY[403 / permission state]
```

---

## 3. Recommended app navigation model

```mermaid
flowchart LR
    subgraph Principal
        P1[Home]
        P2[Students]
        P3[Attendance]
        P4[Fees]
        P5[More]
    end

    subgraph Parent
        R1[Home]
        R2[Attendance]
        R3[Fees]
        R4[Messages]
        R5[More]
    end

    subgraph Student
        S1[Home]
        S2[Schedule]
        S3[Assignments]
        S4[Academics]
        S5[More]
    end

    AI((AI)) --- P1
    AI --- R1
    AI --- S1
```

AI is globally reachable but does not bypass the user’s permission scope.

---

## 4. Admissions lifecycle

```mermaid
flowchart TD
    WEB[Website enquiry / staff entry] --> NEW[New]
    NEW --> CONTACT[Contacted]
    CONTACT --> DOCS[Documents requested]
    DOCS --> ASSESS[Assessment]
    ASSESS --> INTERVIEW[Interview if required]
    INTERVIEW --> DECISION{Decision}

    DECISION -- Reject --> REJECTED[Rejected / Closed]
    DECISION -- Waitlist --> WAIT[Waitlisted]
    DECISION -- Offer --> OFFER[Offer]

    OFFER --> ACCEPT{Family accepts?}
    ACCEPT -- No --> LOST[Declined / Expired]
    ACCEPT -- Yes --> TOKEN[Token / admission fee]

    TOKEN --> VERIFY[Final verification]
    VERIFY --> ENROLL[Enroll]

    ENROLL --> STUDENT[Student record]
    ENROLL --> GUARDIAN[Guardian links]
    ENROLL --> CLASS[Class / section]
    ENROLL --> FEES[Fee plan]
    ENROLL --> ACCOUNTS[Portal accounts]
```

---

## 5. Fee lifecycle

```mermaid
flowchart TD
    PLAN[Fee plan<br/>currency + tax treatment per component] --> ASSIGN[Assign to learner]
    ASSIGN --> ADJUST[Apply concessions / scholarships / add-ons]
    ADJUST --> DRAFT[Draft invoice<br/>editable, no number]

    DRAFT --> ISSUE[Issue<br/>allocate number from series]
    ISSUE --> FISCAL{Jurisdiction requires<br/>e-invoicing?}
    FISCAL -- Yes --> CLEAR[Submit to fiscal channel<br/>store authority reference]
    FISCAL -- No --> NOTIFY[Notify payer]
    CLEAR --> NOTIFY

    NOTIFY --> STATE{Payer action}
    STATE --> PAY[Pay]
    STATE --> INSTALL[Request instalment]
    STATE --> SUPPORT[Ask accounts / AI explanation]

    INSTALL --> REVIEW[Accounts review]
    REVIEW --> IAPP{Approved?}
    IAPP -- Yes --> SCHEDULE[Instalment schedule]
    IAPP -- No --> NOTIFY2[Notify payer]

    PAY --> METHOD[Resolve methods<br/>by payer country]
    METHOD --> PSP[Payment provider for that market]
    PSP --> SCA{Authentication<br/>required?}
    SCA -- Yes --> AUTH[3-D Secure / bank redirect / mandate]
    SCA -- No --> WEBHOOK[Verified webhook]
    AUTH --> WEBHOOK

    WEBHOOK --> ASYNC{Settled?}
    ASYNC -- Pending --> PENDINGSTATE[Payment initiated<br/>shown distinctly to payer]
    PENDINGSTATE --> WEBHOOK
    ASYNC -- Yes --> RECORD[Record payment<br/>charge + settlement currency, fees, FX]

    RECORD --> ALLOCATE[Allocate to invoice<br/>invoice currency authoritative]
    ALLOCATE --> RECON[Reconciliation]
    RECON --> RECEIPT[Generate receipt<br/>payer language + locale]
    RECEIPT --> COMPLETE[Update payer + reports]

    RECORD -. weeks later .-> REVERSAL[Reversal / chargeback]
    REVERSAL --> UNPAID[Invoice returns to unpaid<br/>audited]
```

---

## 6. Attendance and leave flow

```mermaid
flowchart TD
    ROSTER[Teacher opens class roster] --> CACHE[Load roster / offline cache]
    CACHE --> MARK[Mark Present / Absent / Late / Leave]
    MARK --> SUBMIT[Submit attendance]
    SUBMIT --> VALIDATE[Server validates teacher + class + session]

    VALIDATE -- Invalid --> ERROR[Show conflict/error]
    VALIDATE -- Valid --> SAVE[Save attendance]
    SAVE --> CHECK[Evaluate thresholds / exceptions]

    CHECK --> ALERT{Action needed?}
    ALERT -- No --> DONE[Complete]
    ALERT -- Yes --> NOTIFY[Create alert / notification]

    PARENT[Parent creates leave request] --> REASON[Reason + dates + attachment]
    REASON --> REVIEW[Teacher/admin review]
    REVIEW --> DECISION{Approve?}
    DECISION -- Yes --> APPROVE[Approved leave]
    DECISION -- No --> REJECT[Rejected]
    APPROVE --> UPDATE[Attendance updated according to policy]
    UPDATE --> AUDIT[Audit history]
```

---

## 7. Timetable conflict/substitution flow

```mermaid
flowchart TD
    EDIT[Create / edit timetable slot] --> RULES[Conflict engine]
    RULES --> CONFLICT{Conflict?}

    CONFLICT -- No --> SAVE[Save timetable]
    CONFLICT -- Yes --> SHOW[Show reason + alternatives]
    SHOW --> CHANGE[Select alternative]
    CHANGE --> RULES

    ABSENT[Teacher becomes unavailable] --> IMPACT[Find impacted periods]
    IMPACT --> CANDIDATES[Rank substitute candidates]
    CANDIDATES --> ASSIGN[Coordinator assigns]
    ASSIGN --> SAVE2[Update timetable]
    SAVE2 --> NOTIFY[Notify staff/classes]
    NOTIFY --> AUDIT[Audit]
```

---

## 8. Messaging flow

```mermaid
flowchart TD
    COMPOSE[User composes message] --> PARTICIPANTS[Validate participants]
    PARTICIPANTS --> PERMISSION[Check relationship + permission]

    PERMISSION -- Denied --> STOP[Block send]
    PERMISSION -- Allowed --> STORE[Store durable message]

    STORE --> EVENT[Create outbox event]
    EVENT --> REALTIME[Realtime delivery]
    EVENT --> PUSH[Push job]
    EVENT --> EMAIL[Email/SMS/WhatsApp if configured]

    REALTIME --> THREAD[Recipient thread]
    PUSH --> THREAD
    EMAIL --> THREAD

    THREAD --> READ[Read receipt / unread count]
```

---

## 9. AI read flow

```mermaid
sequenceDiagram
    participant U as User
    participant C as Web/Mobile Client
    participant A as AI Orchestrator
    participant P as Policy Engine
    participant T as Domain Tools
    participant D as Domain/Data Layer

    U->>C: Ask question
    C->>A: Prompt + authenticated context
    A->>P: Resolve allowed tools and scope
    P-->>A: Allowed tool set
    A->>T: Structured tool call
    T->>D: Authorized domain query
    D-->>T: Scoped records
    T-->>A: Evidence + source references
    A-->>C: Answer + structured citations
    C-->>U: Render response + tappable sources
```

---

## 10. AI action confirmation flow

```mermaid
sequenceDiagram
    participant U as User
    participant AI as AI Orchestrator
    participant P as Policy Engine
    participant DB as Proposal Store
    participant APP as Domain Service
    participant AUD as Audit Log

    U->>AI: "Move 11B Physics to Lab 3"
    AI->>P: Can user propose this action?
    P-->>AI: Yes
    AI->>APP: Validate proposed arguments (read-only)
    APP-->>AI: Valid + affected records
    AI->>DB: Save PROPOSED action
    AI-->>U: Show preview and Confirm button

    U->>AI: Confirm
    AI->>P: Re-check current permission
    AI->>APP: Re-check current record state
    APP-->>AI: Still valid
    AI->>APP: Execute idempotent command
    APP->>AUD: Record actor + before/after + source=AI
    APP-->>AI: Success
    AI-->>U: Action completed
```

---

## 11. Parent fee payment flow

```mermaid
sequenceDiagram
    participant P as Parent
    participant APP as Mobile/Web
    participant API as THATCAMPUS API
    participant PAY as Payment Provider
    participant W as Payment Webhook
    participant LED as Fee Ledger

    P->>APP: Open Term 2 invoice
    APP->>API: Get invoice
    API-->>APP: Amount + line items + status
    P->>APP: Pay
    APP->>API: Create payment intent
    API->>PAY: Create gateway transaction
    PAY-->>APP: Checkout/payment UI
    P->>PAY: Complete payment
    PAY->>W: Signed webhook
    W->>API: Verified payment event
    API->>LED: Record + allocate payment
    LED-->>API: Invoice paid/part-paid
    API-->>APP: Realtime/push status update
    APP-->>P: Receipt available
```

---

## 12. Parent child-scope flow

```mermaid
flowchart TD
    GUARDIAN[Guardian account] --> LINK[StudentGuardian links]
    LINK --> C1[Child A]
    LINK --> C2[Child B]

    GUARDIAN --> SWITCH[Child switcher]
    SWITCH --> SELECT{Selected child}

    SELECT --> C1
    SELECT --> C2

    C1 --> A1[Attendance]
    C1 --> F1[Fees]
    C1 --> T1[Timetable]
    C1 --> AC1[Academics]

    C2 --> A2[Attendance]
    C2 --> F2[Fees]
    C2 --> T2[Timetable]
    C2 --> AC2[Academics]

    GUARDIAN --> FAMILY[Family-level notices/messages]
```

---

## 13. Student assignment flow

```mermaid
flowchart TD
    TEACHER[Teacher creates assignment] --> PUBLISH[Publish]
    PUBLISH --> NOTIFY[Notify class]
    NOTIFY --> STUDENT[Student opens assignment]
    STUDENT --> WORK[Read instructions/resources]
    WORK --> SUBMIT[Upload/submit]
    SUBMIT --> VALIDATE[Validate deadline/file]
    VALIDATE --> STORED[Submission stored]
    STORED --> TEACHER2[Teacher reviews]
    TEACHER2 --> GRADE[Grade + feedback]
    GRADE --> RELEASE[Release result]
    RELEASE --> STUDENT2[Student sees feedback]
    RELEASE --> PARENT[Parent sees status/result if enabled]
```

---

## 14. Technical data/event flow

```mermaid
flowchart LR
    CLIENTS[Web / Android / iOS]
    API[API]
    DB[(PostgreSQL)]
    OUTBOX[(Transactional Outbox)]
    REDIS[(Redis)]
    WORKERS[Workers]
    WS[Realtime Gateway]
    OBJ[(Object Storage)]
    PROVIDERS[Push / Email / SMS / Payments]
    SEARCH[(Search)]
    AI[AI Orchestrator]

    CLIENTS --> API
    API --> DB
    API --> OUTBOX
    API --> OBJ
    API --> REDIS

    OUTBOX --> WORKERS
    WORKERS --> PROVIDERS
    WORKERS --> SEARCH
    WORKERS --> WS

    WS --> CLIENTS

    CLIENTS --> AI
    AI --> API
```

---

## 15. Release evolution

```mermaid
flowchart LR
    P0[MVP 1<br/>Core operations] --> P1[MVP 2<br/>Workflow intelligence]
    P1 --> P2[MVP 3<br/>Automation + integrations]

    P0 --> A0[AI read-only + citations]
    P1 --> A1[AI drafts + action proposals]
    P2 --> A2[Confirmed AI actions]
```

---

## 16. Architectural rule represented visually

```mermaid
flowchart TD
    UI[UI / AI] --> API[Application API]
    API --> POLICY[Authorization + Domain Rules]
    POLICY --> DATA[(Data)]

    BAD1[Modified client] -. cannot bypass .-> POLICY
    BAD2[LLM] -. no direct SQL .-> DATA
    BAD3[Push provider] -. not source of truth .-> DATA
    BAD4[Payment gateway] -. not fee ledger .-> DATA
```

---

## 17. Product lifecycle summary

```mermaid
flowchart LR
    PROSPECT[Prospective family]
    APPLICANT[Applicant]
    STUDENT[Student]
    FAMILY[Active family]
    SCHOOL[School operations]

    PROSPECT --> APPLICANT
    APPLICANT --> STUDENT
    STUDENT <--> FAMILY
    FAMILY <--> SCHOOL
    STUDENT <--> SCHOOL

    AI((AI Assistant)) --- SCHOOL
    AI --- FAMILY
    AI --- STUDENT
```

The same underlying school records power every authorized experience.

---

## 18. Cell-based scale-out topology

At 10,000 tenants the tenant population is split across cells. Each cell is a complete vertical slice; a thin global control plane routes to it and holds no school data.

```mermaid
flowchart TD
    CLIENT[Web / Mobile client] --> EDGE[Edge / API gateway]

    subgraph CONTROL[Global control plane - holds no school data]
        DIR[Tenant directory<br/>tenant to cell]
        IDP[Identity / session]
        BILL[Billing / subscription]
        OPS[Super-admin tooling]
    end

    subgraph C1[Cell 1 - 500 tenants]
        A1[API pods] --> D1[(PostgreSQL primary)]
        A1 --> R1[(Read replicas)]
        W1[Workers] --> D1
        Q1[Redis queues + cache]
        S1[Search index]
    end

    subgraph C2[Cell 2 - 500 tenants]
        A2[API pods] --> D2[(PostgreSQL primary)]
        A2 --> R2[(Read replicas)]
        W2[Workers] --> D2
    end

    subgraph CN[Cell N]
        AN[API pods] --> DN[(PostgreSQL primary)]
        WN[Workers] --> DN
    end

    EDGE --> DIR
    EDGE --> IDP
    EDGE --> ROUTE{Resolve cell from token}

    ROUTE --> A1
    ROUTE --> A2
    ROUTE --> AN

    W1 --> ANALYTICS[(Analytical store)]
    W2 --> ANALYTICS
    WN --> ANALYTICS

    ANALYTICS --> XREP[Cross-tenant + operator reporting]
    ANALYTICS --> ARCHIVE[(Cold archive - Parquet)]
```

A cell never queries another cell's database. Anything spanning tenants is answered by the analytical store.

---

## 19. Attendance burst write path

The morning register is the highest-pressure write path in the product. Everything not required for the teacher's confirmation happens after commit.

```mermaid
sequenceDiagram
    participant T as Teacher app
    participant API as API (cell)
    participant DB as PostgreSQL (partitioned)
    participant OB as Outbox
    participant W as Worker
    participant P as Parent

    T->>API: Submit register (session, ~40 students, idempotency key)
    API->>API: Permission check - attendance.mark on assigned_classes

    rect rgb(240, 245, 250)
        note over API,OB: One transaction
        API->>DB: Single multi-row INSERT into current month partition
        API->>DB: Update AttendanceSession status
        API->>OB: Write outbox event
    end

    DB-->>API: Commit
    API-->>T: Confirmed (target p95 < 800 ms)

    OB->>W: attendance.submitted
    W->>DB: Update daily + student summary rollups
    W->>P: Absence notifications (batched, rate-limited)
    W->>W: Flag missing registers for follow-up
```

Dashboards and AI answers read the rollup tables, never the raw partitions.

---

## 20. Scale staging

Tenant count, not feature count, forces each transition.

```mermaid
flowchart LR
    S1[Stage 1<br/>up to ~100 tenants<br/>single primary]
    S2[Stage 2<br/>~1,000 tenants<br/>pooler + partitioning<br/>+ read replicas]
    S3[Stage 3<br/>~3,000 tenants<br/>dedicated realtime + search<br/>audit and analytics split out]
    S4[Stage 4<br/>10,000 tenants<br/>cells]

    S1 --> S2 --> S3 --> S4

    S2 -. first hard failure .-> POOL[Connection pooler<br/>arrives ~100 tenants]
    S3 -. saturation point .-> BURST[Morning attendance burst<br/>not total volume]
    S4 -. requires .-> TID[tenant_id on every record<br/>no cross-module table access]
```

Extracting services does not relieve core data pressure. Only splitting the data tier does.

---

## 21. Institution profile resolution

One domain model serves schools, playschools, coaching centres and colleges. Institution type resolves a capability profile and a vocabulary pack; it never forks the schema.

```mermaid
flowchart TD
    TENANT[Tenant] --> TYPE[institution_type]
    TENANT --> JUR[country + jurisdiction]
    TENANT --> CUR[base currency]
    TENANT --> CAL[calendar + timezone]
    TENANT --> LOC[locale + terminology pack]

    TYPE --> PROFILE[Capability profile]
    JUR --> TAX[Tax profile + invoice series]
    JUR --> PRIV[Privacy + age of majority rules]
    JUR --> PAYCFG[Payment providers + methods]

    PROFILE --> NAV[Navigation + enabled modules]
    PROFILE --> ASSESS{Assessment shape}
    ASSESS --> MARKS[Marks + report card<br/>school]
    ASSESS --> OBS[Narrative observations<br/>playschool]
    ASSESS --> SCORE[Test scores<br/>coaching]
    ASSESS --> CREDIT[Credits + GPA + transcript<br/>college]

    PROFILE --> GROUPING{Class grouping}
    GROUPING --> GRADE[Grade + section]
    GROUPING --> BATCH[Rolling batch]
    GROUPING --> COURSE[Programme + course]

    PRIV --> GUARD{Learner is a minor?}
    GUARD -- Yes --> GLINK[Guardian holds access + consent]
    GUARD -- No --> SELF[Learner holds access<br/>guardian access only if granted]

    TAX --> BILLING[Billing behaviour]
    CUR --> BILLING
    PAYCFG --> BILLING
    LOC --> RENDER[Rendered terminology + formats]
```

The same records, the same permissions engine. Only the profile differs.

---

## 22. Invoice document lifecycle

An issued invoice is a legal document. It is never edited.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Draft: edit freely
    Draft --> Issued: allocate number from series

    Issued --> PartlyPaid: payment allocated
    Issued --> Overdue: due date passes
    PartlyPaid --> Paid: balance cleared
    Overdue --> PartlyPaid: payment allocated
    Overdue --> Paid: balance cleared

    Paid --> Reversed: direct debit reversal / chargeback
    Reversed --> Overdue: balance restored

    Issued --> Cancelled: cancelled, number retained
    Issued --> Credited: credit note issued
    PartlyPaid --> Credited: credit note issued
    Paid --> Credited: credit note issued

    Credited --> Refunded: surplus returned to payer
    Refunded --> [*]
    Paid --> [*]
    Cancelled --> [*]

    note right of Issued
        Immutable from here.
        Corrections are credit notes,
        never edits.
    end note
```

Cancelled and credited documents are retained permanently. Financial retention is set by jurisdiction and overrides the general archival policy.

---

## 23. AI feature compliance gate

Education AI is classified as high-risk in the EU where it touches admission, assessment, educational level or exam monitoring. Some capabilities are prohibited outright. Run every AI feature through this gate at design time, not at review time.

```mermaid
flowchart TD
    FEAT[Proposed AI feature] --> BAN{Infers emotion in a classroom,<br/>scores people socially,<br/>or scrapes faces?}
    BAN -- Yes --> STOP[Do not build<br/>prohibited practice]
    BAN -- No --> HR{Used for admission, assessment,<br/>educational level, or exam monitoring?}

    HR -- No --> STD[Standard obligations<br/>transparency, citations,<br/>permission scope, logging]
    HR -- Yes --> HIGH[High-risk obligations]

    HIGH --> RM[Risk management + data governance]
    HIGH --> DOC[Technical documentation]
    HIGH --> LOG[Automatic event logging retained]
    HIGH --> OVER[Human oversight by design]
    HIGH --> ACC[Accuracy + robustness targets]
    HIGH --> CONF[Conformity assessment + registration]
    HIGH --> POST[Post-market monitoring]

    STD --> AUTO
    HIGH --> AUTO{Decision has legal or<br/>similarly significant effect?}
    AUTO -- Yes --> HUMAN[No solely automated execution<br/>human confirms and is accountable]
    HUMAN --> CONTEST[Explanation, human review<br/>and contest workflow]
    AUTO -- No --> SHIP

    CONTEST --> SHIP[Ship, per-tenant and<br/>per-region toggleable]
    STD --> SHIP
```

A feature that cannot be offered compliantly in a market is switched off there cleanly. It is never silently degraded.

---

## 24. Data subject request flow

Institutions are the controllers and must be able to discharge their obligations inside the product.

```mermaid
flowchart TD
    REQ[Request received<br/>learner, guardian or adult learner] --> ID[Verify identity]
    ID --> WHO{Who holds the rights?}

    WHO -- Minor --> GUARD[Guardian exercises them]
    WHO -- Adult learner --> SELF[Learner exercises them]

    GUARD --> SCOPE
    SELF --> SCOPE[Determine scope across modules]

    SCOPE --> CLOCK[Start statutory clock<br/>deadline varies by jurisdiction]
    CLOCK --> TYPE{Request type}

    TYPE --> ACCESS[Access / export]
    TYPE --> CORRECT[Correction]
    TYPE --> ERASE[Erasure]
    TYPE --> OBJECT[Objection / restriction]

    ERASE --> RETAIN{Statutory retention<br/>applies to any of it?}
    RETAIN -- Yes --> PARTIAL[Erase by purpose<br/>retain financial and statutory records<br/>explain what is kept and why]
    RETAIN -- No --> FULL[Erase]

    ACCESS --> RESTRICTED{Restricted records<br/>in scope?}
    RESTRICTED -- Yes --> LEAD[Designated lead reviews<br/>before release]
    RESTRICTED -- No --> COMPILE
    LEAD --> COMPILE[Compile response]

    CORRECT --> COMPILE
    OBJECT --> COMPILE
    PARTIAL --> COMPILE
    FULL --> COMPILE

    COMPILE --> RELEASE[Review and release]
    RELEASE --> CLOSE[Close, whole chain audited]
```

Deletion is per purpose, never per person. Safeguarding and financial records commonly survive an erasure request that clears everything else.
