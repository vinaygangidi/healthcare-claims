# Data Dictionary — Test Claims & Payer Data

Quick reference for claim and payer data structure.

## claim_data.json Schema

```json
{
  "claims": [
    {
      "claim_id": "CLM-2024-001",           // Unique claim identifier
      "control_number": "00001",             // Payer control number
      "submission_date": "2024-07-15",       // Claim submission date (YYYY-MM-DD)
      "patient": {
        "name": "John Smith",
        "dob": "1965-03-20",                 // Date of birth (YYYY-MM-DD)
        "member_id": "MBR123456789",         // Insurance member ID
        "gender": "M|F",
        "relationship": "self|spouse|child|dependent"
      },
      "provider": {
        "facility_npi": "1234567890",        // 10-digit NPI
        "facility_name": "Main Medical Center",
        "provider_npi": "9876543210",
        "provider_name": "Dr. Jane Doe",
        "specialty": "Internal Medicine",
        "tax_id": "12-3456789"               // EIN (XX-XXXXXXX)
      },
      "service_lines": [
        {
          "line_number": 1,
          "cpt_code": "99213",                // 5-digit procedure code
          "description": "Office visit",
          "icd10_primary": "Z00.00",          // Primary diagnosis
          "icd10_supporting": ["E11.9"],      // Secondary diagnoses
          "units": 1,                         // Quantity
          "charge_amount": 150.00,            // Billed amount
          "dos_start": "2024-06-15",          // Date of service (YYYY-MM-DD)
          "dos_end": "2024-06-15",
          "place_of_service": "11",           // See POS codes below
          "modifier": null                    // Optional: -LT, -RT, -50, etc.
        }
      ],
      "total_charge": 235.00,
      "scenario": "1 - Clean Claims"         // Optional: scenario description
    }
  ]
}
```

## payer_data.json Schema

```json
{
  "plan_name": "PPO Standard",
  "payer_name": "United Healthcare",
  "group_number": "GRP001",
  
  "patient_eligibility": {
    "member_id": "MBR123456789",
    "effective_date": "2024-01-01",
    "termination_date": null,               // null = active, otherwise date ended
    "is_active": true,
    "relationship": "self|spouse|child",
    "coverage_type": "PPO|HMO|Medicare|Medicaid"
  },
  
  "coverage_rules": {
    "deductible_individual": 1500.00,
    "deductible_family": 3000.00,
    "deductible_met_ytd": 500.00,           // Year-to-date amount applied
    "copay_office_visit": 30.00,
    "copay_urgent_care": 75.00,
    "copay_specialist": 60.00,
    "coinsurance_pct": 20,                  // % patient pays after deductible
    "out_of_pocket_max": 5000.00,
    "out_of_pocket_met_ytd": 1200.00,
    "exclusions": [],                       // Services not covered
    "covered_services": [...]               // Services covered
  },
  
  "fee_schedule": {
    "99213": {
      "allowed_amount": 120.00,              // Contracted fee
      "unit_value": 120.00,                  // Per unit
      "requires_modifier": false
    }
    // Map CPT code → allowed amount
  },
  
  "prior_auth_requirements": [
    {
      "cpt_code": "27447",
      "description": "Total knee replacement",
      "requires_auth": true
    }
  ],
  
  "prior_auth_records": [
    {
      "cpt_code": "27447",
      "auth_number": "AUTH-12345",
      "dos_start": "2024-07-15",
      "dos_end": "2024-12-31",               // Validity window
      "approved": true
    }
  ],
  
  "network_status": "in_network|out_of_network",
  "bundling_rules": [
    {
      "primary_code": "47562",
      "component_codes": ["99213"],
      "rule": "Bundled together; only bill primary"
    }
  ]
}
```

## Key Code Systems

### Place of Service (POS) Codes
- 11: Office
- 21: Inpatient hospital
- 22: Outpatient hospital
- 23: Emergency room
- 24: Ambulatory surgery center
- 71: State or local public health clinic

### CPT Code Examples (Used in Test Data)
- **99213**: Office visit, established patient, low complexity
- **99214**: Office visit, established patient, moderate complexity
- **93000**: EKG, complete
- **71020**: Chest X-ray, 2 views
- **80053**: Comprehensive metabolic panel
- **97161**: Physical therapy evaluation
- **27447**: Total knee replacement (major surgery)
- **47562**: Laparoscopic cholecystectomy
- **20610**: Arthrography, ankle, diagnostic
- **73610**: MRI, ankle, complete

### ICD-10 Code Examples (Used in Test Data)
- **Z00.00**: Encounter for general adult medical examination
- **E11.9**: Type 2 diabetes mellitus without complications
- **I10**: Essential (primary) hypertension
- **J06.9**: Acute upper respiratory infection, unspecified
- **M17.11**: Primary osteoarthritis, right knee
- **K80.00**: Calculus of gallbladder with acute cholecystitis

### Denial Code Examples (Standard EDI)
- **CO-4**: Claim/service not covered by this payer
- **CO-97**: Patient responsibility exceeded plan maximum
- **PR-1**: Patient has no liability; claim denied per plan terms
- **CO-9**: Patient age not within plan coverage limits
- **PR-96**: Non-covered service included; patient liable for entire claim

### Era Claim Codes (Remittance)
- **A**: Approved
- **R**: Rejected (denied in full)
- **D**: Denied (partial)
- **F**: Forwarded to secondary payer

## Test Data Scenarios at a Glance

| Sample | Theme | # Claims | Key Characteristic |
|--------|-------|----------|-------------------|
| 01 | Clean | 5 | All valid, no flags, straightforward payment |
| 02 | Denial | 5 | Missing auth, ineligible, exclusions, med necessity |
| 03 | COB | 3 | Primary + secondary insurance coordination |
| 04 | NCCI | 4 | Unbundling, missing modifiers, mutually exclusive |
| 05 | Underpay | 4 | Out-of-network variance, bundling, upgrades |

## Agent Input/Output by Scenario

### Scenario 1 (Clean)
- Agent 1: No flags, is_clean=true
- Agent 2: is_eligible=true, all covered
- Agent 3: All approved, no variance
- Agent 4: claim_status=CLEAN (0 denials)
- Agent 5: Full payment, no holds
- Agent 6: 100% clean claim rate (this sample)

### Scenario 2 (Denial)
- Agent 1: Flags present (missing NPI, invalid ICD-10, etc.)
- Agent 2: Blocks on ineligibility or missing auth
- Agent 3: May skip if Agent 2 blocked
- Agent 4: Classifies denial codes (CO-4, PR-1, etc.)
- Agent 5: Conditional posting (hold if ERROR flags)
- Agent 6: Denial rate 100% (this sample)

### Scenario 3 (COB)
- Agent 1: No flags
- Agent 2: Flags COB requirement
- Agent 3: Calculates primary allowed, secondary remaining
- Agent 4: If any denial, analyzes
- Agent 5: Two ERA entries (primary + secondary)
- Agent 6: COB split detection

### Scenario 4 (NCCI)
- Agent 1: Flags missing modifiers, unbundling suspicion
- Agent 2: No eligibility block
- Agent 3: Detects bundling, recalculates allowed
- Agent 4: If variance significant, flags underpayment risk
- Agent 5: Posting reflects corrected bundle
- Agent 6: Coding quality metrics

### Scenario 5 (Underpay)
- Agent 1: No flags
- Agent 2: Eligible
- Agent 3: Flags EXCESSIVE_BILLED_AMOUNT, calculates variance
- Agent 4: Alerts on underpayment if >25% variance
- Agent 5: Posts payment + contractual write-off
- Agent 6: Underpayment variance trending

## Data Validation Checklist

Before using test data, verify:

- [ ] All NPIs are 10 digits
- [ ] All DOB, DOS dates are valid (YYYY-MM-DD)
- [ ] CPT codes are 5 digits and valid
- [ ] ICD-10 codes are valid format (e.g., A01.0, Z00.00)
- [ ] Amounts are positive (except adjustments)
- [ ] Member IDs are present and unique per claim
- [ ] Fee schedule contains all CPT codes billed
- [ ] Eligibility snapshot has entry for each patient member_id
- [ ] Place of service codes match POS code list
- [ ] Scenario descriptions match actual claim content
