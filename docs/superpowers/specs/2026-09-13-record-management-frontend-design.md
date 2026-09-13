# Record Management System — Frontend Design Spec

**Date:** 2026-09-13
**Status:** Approved
**Scope:** Both apps — Dept Record Management System (admin) and Students Detail View (student portal) — as one visual family. Plus two functional refinements to setup and record creation.

---

## 1. Design Direction

**Contemporary Academic.** A refined, modern take on academic aesthetics that features the department's identity prominently while keeping interfaces clean, efficient, and warm. Neither corporate-SaaS nor traditional-ledger. One institution, two moods.

**Brand presence:** Department-led. The department name / code / institution (set during setup) is the visible identity in both apps.

**Layout:** Context-aware — dense, left-aligned scanning layouts for admin tables/forms; centered, generous-whitespace layouts for student-facing views.

---

## 2. Design Tokens

### Color

| Role | Value | Usage |
|------|-------|-------|
| Primary | `#0F172A` | Deep slate blue — nav brand, headings, primary buttons, active states |
| Primary-light | `#1E293B` | Primary button hover |
| Primary-lighter | `#334155` | Secondary hover text |
| Secondary / Muted text | `#64748B` | Body/muted text, non-active nav links |
| Accent | `#10B981` | Emerald — success, links, focus rings, approvals |
| Accent-light | `#34D399` | Accent hover / lighter tint |
| Background | `#F8FAFC` | App background |
| Card background | `#FFFFFF` | Cards, modals, tables |
| Border | `#E2E8F0` | Hairline separators |
| Danger | `#EF4444` | Errors, deletes, rejections |
| Shadow-sm | `0 1px 3px rgba(0,0,0,0.1)` | Static cards |
| Shadow-md | `0 4px 6px -1px rgba(0,0,0,0.1)`, `0 2px 4px -2px rgba(0,0,0,0.1)` | Auth cards |
| Shadow-lg | `0 10px 15px -3px rgba(0,0,0,0.1)`, `0 4px 6px -2px rgba(0,0,0,0.1)` | Modals |

### Typography

- **Single family:** Inter (fallback: `-apple-system, "Segoe UI", Roboto, sans-serif`)
- **Weights:** 400 body, 500 labels/buttons/nav, 600 subheads, 700 page headings
- **Mono:** `SFMono-Regular, Consolas, Menlo` — reserved for schema/JSON textareas
- **Scale (roughly):** page title 1.75rem/700; card title 1.5rem/600; group heading 1.125rem/600; body 0.875rem/400; small/meta 0.75-0.875rem
- Line length: content max-width ~1152px, containers gutter 1.5rem

### Radius & Spacing

- Radius: 8px (buttons, cards, inputs, modals); 6px (schema field cards); 4px (mini controls)
- Spacing base: 0.75rem inputs, 1rem cell padding, 1.5rem card padding, 2rem section gutter
- Focus ring: `0 0 0 3px rgba(16,185,129,0.2)` on accent

---

## 3. Components

### Navigation
- Fixed full-width bar, white, 1px bottom border, subtle shadow
- Left: brand (department identity) — bold 1.25rem deep slate
- Right: links (Dashboard, Settings, etc.) + Logout button
- Links: muted `--text-muted`, 500 weight; active/hover deep slate. Logout styled as a quiet text button.

### Cards
- `--card-bg`, 1px border, 8px radius, `--shadow-sm`, 1.5rem padding

### Buttons
- Radius 8px, font 500, family Inter
- `btn-primary`: deep slate bg, white text; hover `--primary-light`
- `btn-secondary`: `--border` bg, deep text, 1px border; hover grey
- `btn-sm`: compact 0.5rem × 1rem, bordered
- `btn-danger`: red-tinted bg/border; hover fills red
- `btn-link`: accent, underlined, quiet
- `btn-add-field`: white bg, primary border, primary text

### Forms
- Top-aligned labels, 0.875rem/500
- Inputs: full-width, 0.75rem padding, 1px `--border`, 8px radius, transparent focus → accent border + 3px accent-tint ring
- Textareas: mono font for schema/JSON; min-height 120px, vertical resize

### Tables
- Full-width, collapsed borders, 1px `--border` row rules
- Sticky header, 600 weight, `--background` tint
- Hover row: `rgba(16,185,129,0.03)`; even rows: `rgba(0,0,0,0.01)`
- Numeric/action columns right-aligned

### Modals
- Centered, `rgba(0,0,0,0.4)` overlay + 2px backdrop blur, z-index 1000
- White card, `--shadow-lg`, 8px radius, max-width 500px / 85vh scroll
- 200ms fade+rise entrance
- Footer: right-aligned actions, top hairline
- `wide-modal` variant: 900px

### Status badges
- Pending: amber (approx `#D97706`-ish) — set in depart system; Approved: accent emerald; Rejected: red

### Empty / Error / Success states
- Empty: centered muted text
- Error: red text on `#fee2e2` fill with red border, 1rem padding
- Success: emerald text on `#ecfdf5` fill with emerald border

### Student portal specifics
- Centered welcome block: name heading + emerald CGPA pill
- Record details: responsive `repeat(auto-fill, minmax(200px,1fr))` grid of bordered value cards
- Course groups: card per session|level, inner table with tinted `tfoot` totals

---

## 4. Functional Refinements (in scope)

### 4.1 Setup schema builder (`setup.html`)
**Current behavior:** The "Use Defaults" button calls a function that `api.onboard`s a hard-coded schema and immediately redirects.

**Target behavior:**
1. On page load, the **default student schema is pre-loaded into the field editor** (`currentSchema`), visible and editable — not fired only by a button.
   - Default fields: Student ID (text, required), Full Name (text, required), Level (text, required), CGPA (number, optional)
2. The student **PIN** field is included but **hidden in the editor UI**, and set server-side/when saving to a default value of **`12345678`**. The PIN is not user-editable in setup.
3. **In-browser guard:** inform the admin that *Student ID* and *Full Name* are necessary — they cannot be removed; removing/editing them shows a clear notice (a warning line under the builder + prevents removal of those two fields).
4. "Use Defaults" button behavior re-evaluated: with the defaults pre-loaded into the editor, the button is no longer needed for prefilling. It is repurposed or removed; the collection name defaults to `dept-students-field` in the editor input.

### 4.2 Record type on create (`dashboard.html`)
**Current behavior:** Every record is treated as a student — all get "Add Course" in their Details modal.

**Target behavior:**
1. On **Add New Record**, the modal first asks for the record type: **Student** or **Staff**.
2. Records carry the chosen type (persisted in the record data, e.g. a field `record_type = 'student' | 'staff'`).
3. Only **Student** records expose the **Details → Add Course** capability in the details modal. Staff records show no course section and no Add Course button.
4. The records table may show the type column; Details modal adapts.

---

## 5. Files Touched

**Admin app** (`Dept Record Management System/public/`):
- `css/style.css` — full token/component restyle
- `index.html` — login page (auth card restyle)
- `dashboard.html` — records table, add-record modal (record type step), details modal (student/staff adaptation)
- `setup.html` — schema editor pre-load, student/staff? no — required-field guard, PIN hidden default
- `corrections.html` — correction cards, status badges
- `settings.html` — (skim + restyle elements used)

**Student portal** (`Students Detail View/`):
- `style.css` — full restyle in the same family
- `portal.html` — welcome/centered layout, record grid, course groups
- `index.html` — student login (`students-detail` login)

**Backend** (`server.js`):
- Record create path — accept/persist `record_type` (student|staff)
- Details/courses endpoints unaffected for staff (no courses); ensure course APIs only apply to student records

---

## 6. Out of Scope / Not Changed
- API contract/schema semantics beyond adding `record_type`
- Database migrations beyond additive `record_type`
- Auth flows (login/logout mechanics unchanged)
- The CGPA/grade-point calculation logic