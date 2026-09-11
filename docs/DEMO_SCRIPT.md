# AI Interview Preparation Kit — Demo Script

## Target duration

60–90 seconds.

## Recording style

- 1080p screen recording (1920x1080, 30 or 60 fps).
- Browser only.
- Clean browser window with bookmarks bar hidden.
- No personal or private information visible (use demo account `demo@example.com` or local test user).
- No terminal windows unless demonstrating the offline batch evaluator.
- No long loading screens; cut or cross-dissolve if live external LLM calls take longer than 15s.
- Use a realistic sample JD and company (e.g., Senior Distributed Systems Engineer at Stripe).
- Keep cursor movements smooth and deliberate.
- Zero fake claims: show actual working application behavior.

## Story

An engineer receives a demanding job description and has limited time before their technical interview. Instead of manually scouring company websites and drafting generic questions, they generate a researched, structured interview kit with atomic requirements, categorised questions, flashcards, confidence tracking, and a day-by-day study schedule.

---

## Shot-by-shot timeline

### 0:00–0:07 — Product opening

- **Visual:** Open browser at `/` (landing page) or `/kits` dashboard showing dark theme, clean typography, and existing kits.
- **Action:** Click "Create New Kit".
- **On-screen caption:**
  > **AI Interview Preparation Kit**
  > *From JD + company URL → researched interview preparation kit*

### 0:07–0:15 — Create kit

- **Visual:** The `/kits/new` create kit form.
- **Action:** Paste a realistic job description (e.g., Senior Backend Engineer), enter company URL (`https://stripe.com` or fixture), and set preparation duration (e.g., `3 days`). Click **Generate Preparation Kit**.
- **On-screen caption:**
  > *Start with the JD, company and available preparation time.*

### 0:15–0:30 — Live generation

- **Visual:** The real-time generation timeline streaming stage-by-stage progress.
- **Action:** Observe the 16-stage pipeline advance: normalizing JD, extracting requirements with verbatim evidence quotes, SSRF-safe crawling, link ranking, question generation, deterministic coverage check, and schedule building.
- **On-screen caption:**
  > *16-stage pipeline with durable background processing*

### 0:30–0:43 — Generated kit

- **Visual:** The kit details viewer (`/kits/:id`).
- **Action:** Quickly navigate across tabs:
  1. **Questions:** Show categorised questions (Technical, System Design, Behavioural, Company-Fit) with difficulty tags and requirement references.
  2. **Role Requirements:** Highlight atomic requirements with `must`/`nice` badges and verbatim evidence quotes.
  3. **Schedule:** Show the deterministic 3-day study schedule with integer study minutes.
  4. **Company Brief:** Show researched company summary with verified pages used.
- **On-screen caption:**
  > *Research-backed, role-specific preparation*

### 0:43–0:53 — Editing

- **Visual:** Question builder actions in place.
- **Action:**
  - Click **Pin** on a high-priority question (shows active pin badge).
  - Click **Edit**, modify the question prompt in the modal, and save (shows optimistic update and version increment).
  - Demonstrate keyboard reordering or delete confirmation.
- **On-screen caption:**
  > *Generated content remains fully editable.*

### 0:53–1:03 — Practice

- **Visual:** Flashcard practice session (`/kits/:id/practice`).
- **Action:**
  - Reveal flashcard front (question/prompt).
  - Click to flip and display the concise answer outline and key points.
  - Rate confidence: "Needs Review", "Getting There", or "Mastered".
- **On-screen caption:**
  > *Practice and track confidence.*

### 1:03–1:12 — Weak spots

- **Visual:** Weak-spots diagnostic report (`/kits/:id/weak-spots`).
- **Action:** Display requirements joined with practice confidence scores and question coverage, highlighting areas that need focused revision.
- **On-screen caption:**
  > *Identify requirements that need more preparation.*

### 1:12–1:20 — Export / final

- **Visual:** Kit details header.
- **Action:** Click **Export**, open the canonical Appendix A JSON modal, click "Copy JSON" or download.
- **On-screen caption:**
  > *Structured preparation you can take with you.*

### 1:20–1:30 — Engineering close

- **Visual:** Brief look at the architecture overview or GitHub repository.
- **On-screen:**
  - "Next.js + Express + MongoDB"
  - "Gemini primary + Groq fallback"
  - "743+ automated tests"
  - "Deterministic batch evaluator"
- **Final frame:**
  > **AI Interview Preparation Kit**
  > *Built for the Trao Full-Stack Engineering Assessment*

---

## Optional voiceover

*(118 words — natural, concise, engineer-to-engineer tone)*

> "This is the AI Interview Preparation Kit.
>
> You paste a job description, provide the company URL, and specify your preparation timeframe.
>
> In the background, a durable 16-stage pipeline extracts atomic requirements with verbatim quotes from the JD, crawls the company website with strict SSRF guards, and generates categorised questions and flashcards.
>
> The LLM handles semantic drafting, while deterministic code guarantees schedule allocation, requirement coverage, and data validation.
>
> Everything generated is fully editable: you can pin, modify, or regenerate individual sections without losing manual work.
>
> In practice mode, you test yourself on flashcards with active recall and confidence tracking, which feeds directly into a diagnostic weak-spots report.
>
> The entire system is covered by 743 tests and runs reproducibly via Docker."
