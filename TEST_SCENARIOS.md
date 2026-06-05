# Test Scenarios & Data Requirements

## Overview

5 test scenarios across 50-100 sample claims, covering major healthcare billing edge cases.

## Scenario 1: Clean Claims (20 claims)

**Theme:** Baseline — all valid, no issues, straightforward payment

**Characteristics:**
- Active patient coverage, effective date before DOS
- Valid CPT/ICD-10 codes aligned with medical necessity
- Single service line or non-bundled multi-line claims
- Billed amount within ±10% of allowed amount
- No prior auth required (or auth already approved)
- No flags or denials

**Expected Flow:**
- Agent 1 (Parser): No flags, is_clean=true
- Agent 2 (Eligibility): is_eligible=true, all services covered at 100% or standard copay/coinsurance
- Agent 3 (Adjudication): All lines approved, clean allowed amounts
- Agent 4 (Denial): claim_status=CLEAN (0 denials)
- Agent 5 (Posting): Full payment posting, no patient responsibility hold

**Variations (5 sub-themes, 4 claims each):**
1. Simple office visit (99213) + basic labs (80053)
2. Multiple office visits same patient (established patient follow-ups)
3. Preventive care (99391-99395 annual wellness)
4. Minor procedures (E&M + procedure, same DOS)
5. Minor surgery with post-op follow-up (global period payment)

**Claims per variation:** 4 claims × 5 variations = 20 total

---

## Scenario 2: Denial Heavy (15 claims)

**Theme:** Common denials providers encounter

**Characteristics by sub-type:**

### 2A: Missing/Expired Prior Authorization (5 claims)
- CPT codes that require payer pre-cert (e.g., 27447 knee replacement, imaging with code 71020)
- No prior auth number in claim
- OR prior auth existed but expired before DOS
- Claim denial code: CO-4 (service not covered / requires auth)

**Example claim:** Total knee replacement (27447), DOS 2024-07-15, no prior auth number

### 2B: Patient Ineligible (3 claims)
- Membership terminated before DOS
- OR membership not yet effective at DOS
- OR patient in waiting period
- Denial code: PR-1 (patient has no liability, claim denied per plan rules)

**Example claim:** Patient coverage ended 2024-06-30, claim for service 2024-07-10

### 2C: Service Excluded from Plan (4 claims)
- Procedure not covered (e.g., cosmetic, experimental)
- OR plan limitation (e.g., PT visit #25 exceeds 20 visit limit per year)
- Denial code: CO-4 (service not covered) or CO-97 (frequency exceeded)

**Example claim:** 25th physical therapy visit (97161) in calendar year

### 2D: Medical Necessity / Coding Mismatch (3 claims)
- CPT code doesn't align with diagnosis codes
- OR service marked as "not medically necessary" by payer review
- Denial code: CO-4 or CR-1 (medical necessity not met)

**Example claim:** Knee MRI (73610) billed with diagnosis Z00.00 (encounter for preventive care) — needs clinical diagnosis

---

## Scenario 3: Coordination of Benefits (COB) (10 claims)

**Theme:** Patient has primary + secondary insurance; claim must be split

**Characteristics:**
- Patient eligible on both plans
- Primary plan processes first, pays up to primary contracted amount
- Secondary plan gets EOB showing primary payment, calculates its responsibility
- Agent 2 flags COB requirement
- Agent 3 calculates primary allowed, secondary allowed
- Agent 5 generates two ERA entries (one per payer)

**Example:** Patient with Medicare primary + supplemental secondary (Medigap)
- Medicare pays 80% after deductible
- Medigap pays gap (up to plan limits)

**Variations (2 claims per variation × 5 variations):**
1. Commercial primary + Medicaid secondary
2. Medicare primary + Medigap secondary
3. Employer plan primary + spouse's plan secondary
4. Workers comp primary + group health secondary
5. Medicaid primary + commercial secondary (unusual but possible)

---

## Scenario 4: Medicare/NCCI Edits (10 claims)

**Theme:** Detect coding violations specific to Medicare

**Characteristics:**
- NCCI (National Correct Coding Initiative) edit violations
- Common: Unbundled procedures that should be one code
- Common: Bilateral procedure billed as two separate lines without modifier
- Agent 1 flags: Missing modifier (-LT, -RT, -50)
- Agent 3 detects unbundling, recalculates as single code

**Variations (2 claims per variation × 5 variations):**
1. Bilateral knee X-rays (71046) billed as 2× 71020 without -LT/-RT modifier
2. Bilateral lab tests (80053) should be bundled, billed separately
3. Global period violation: Pre-op visit bundled into surgery, billed separately
4. Component code used instead of comprehensive code (e.g., 99213 + 99214 same visit)
5. Mutually exclusive edits: Two codes never payable together (e.g., preventive vs problem-focused visit same day)

---

## Scenario 5: Underpayment & Contractual Adjustment (10 claims)

**Theme:** Billed > Allowed; detect variance, calculate write-off

**Characteristics:**
- Billed amount significantly higher than payer's allowed amount
- Agent 3 flags: EXCESSIVE_BILLED_AMOUNT or underpayment variance >25%
- Contractual adjustment calculated (provider write-off)
- Agent 5 alerts if actual payment < expected payment (auditable variance)

**Variations (2 claims per variation × 5 variations):**
1. Out-of-network billed at list price, allowed at discount rate (-40%)
2. Unbundling detected: Two codes billed, only one allowed (agent 3 bundles down)
3. Facility vs professional component split: Claim billed as facility, payer only recognizes professional
4. Upgrade detected: CPT code 99214 billed, only 99213 allowed (cost variance ~40%)
5. Fee schedule year mismatch: Claim uses 2023 fee schedule, payer enforces 2024 rates

---

## Summary Table

| Scenario | Theme | # Claims | Key Flags | Primary Agents |
|----------|-------|----------|-----------|-----------------|
| 1 | Clean | 20 | None | 1,2,3 |
| 2 | Denials | 15 | Missing auth, ineligible, excluded, med necessity | 1,2,3,4 |
| 3 | COB | 10 | Primary/secondary split | 2,3,5 |
| 4 | Medicare NCCI | 10 | Missing modifier, unbundled | 1,3,4 |
| 5 | Underpayment | 10 | Excessive variance, write-off alert | 3,4,5 |
| **TOTAL** | | **65** | | |

---

## Test Data Structure

Each claim scenario has 2 files:

```
backend/data/samples/sample_NN/
  ├── meta.json           # Scenario metadata
  ├── claim_data.json     # Raw claim (one or multiple claims)
  └── payer_data.json     # Payer rules, fee schedule, eligibility snapshot
```

### claim_data.json

Single claim or array of claims. Fields:
- `claim_id`, `control_number`, `submission_date`
- `patient` — name, DOB, member_id, gender, relationship
- `provider` — facility_npi, provider_npi, specialty
- `service_lines[]` — CPT, ICD-10, units, charges, DOS, place_of_service
- `total_charge`

### payer_data.json

- `plan_name`, `payer_name`
- `patient_eligibility` — active, effective_date, termination_date
- `coverage_rules` — deductible, copay, coinsurance, OOP max, exclusions
- `fee_schedule` — CPT → allowed_amount mapping
- `prior_auth_requirements[]` — which CPTs need pre-cert
- `prior_auth_records[]` — existing approvals (empty for scenarios requiring auth)
- `bundling_rules[]` — Medicare NCCI or payer-specific
- `network_status`, `cob_rules` (for COB scenario)

---

## Data Generation Strategy

### Manual Creation (Samples 01-05)

Write out representative claims for each scenario by hand. Use realistic but synthetic data:
- Patient names: John Smith, Jane Doe, etc. (no real PII)
- CPT codes: Real, valid codes from CMS RVS
- ICD-10 codes: Real, valid codes
- Amounts: Realistic (e.g., office visit $100-200, surgery $2000-5000)
- NPI numbers: Synthetic but valid format (10 digits)

### Template Approach for Scaling (if needed)

Create a Python script to generate N claims per scenario:
- Parameterize: patient name template, CPT list, amount ranges, DOS offset
- Generate 2-5 variations automatically
- Manual review for realism

For MVP: Skip automation, hand-craft 65 representative claims.

---

## Acceptance Criteria

### Per Scenario

- [ ] All claims process without exception
- [ ] Flags/denials match expected scenario theme
- [ ] Agent outputs align with business logic
- [ ] JSON schemas valid for all 6 agents

### Overall

- [ ] 65 claims across 5 scenarios
- [ ] At least 1 sample claim per major code path (clean, deny, COB, NCCI, underpay)
- [ ] Realistic medical/billing content (pass sanity review)
- [ ] All claims have matching claim_data + payer_data files
