# Live contracts with no docket (2026-11-02)

Derived from data, read-only. Live = at least one Contract Review line with blank STATUS. No docket = no Enquiry.selectedContractNo carries the contract no. Quotation ref = Contract Review Offer Number (placeholder 0 dropped); the quotation date is not stored in the DB (only in the mails). Items = item types with line counts; Qty = sum of Order Qty.

Re-run (in apps/gmd-quotation-process): `npx tsx scripts/list-contracts-without-docket.ts --md`

| # | Contract no | Party | Quotation ref (Offer No.) | Quotation date | Items | Qty | Contract date |
|---|---|---|---|---|---|---|---|
| 1 | SD24Y-00005 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | SLV x8, SLV RISING x3, SLV-9523 x2, TPAV+SLV x2 | 512 | 8-Apr-2024 |
| 2 | SD24Y-00006 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | SLV x12, SLV RISING x4, TPAV x3, SLV RISING-9523 x1, TPAV+SLV x3, SLV-9523 x2 | 700 | 16-Apr-2024 |
| 3 | SD24Y-00009 | G V P R ENGINEERS LIMITED | ID24Y-142, ID24Y-141 | not in data | DPCV x2, SLV x6 | 354 | 2-May-2024 |
| 4 | SD24Y-00090 | GAIL INDIA LIMITED | ID26Y-27 | not in data | BFV CAST STEEL x12 | 14 | 14-Dec-2024 |
| 5 | SD24Y-00115 | ZUBERI ENGINEERING CONSTRUCTION PRIVATE LIMITED | ID24Y-152, ID24Y-167, ID25Y-92, ID25Y-63 | not in data | SLV x7 | 76 | 9-Jan-2025 |
| 6 | SD24Y-00121 | GAJA ENGINEERING PRIVATE LIMITED | ID26Y-2, ID24Y-186, ID25Y-40, ID26Y-1, ID26Y-3 | not in data | SLV x5, BFV x8, BFV-9523 x1, TPAV+SLV x1 | 53 | 2-May-2025 |
| 7 | SD24Y-00130 | GAJA ENGINEERING PRIVATE LIMITED | ID25Y-13, ID26Y-4, ID26Y-5 | not in data | DPCV x4, SLUICE GATE x1 | 24 | 18-02-2025 |
| 8 | SD24Y-00155 | BLUE STAR LIMITED | ID25Y-8, ID25Y-22, ID25Y-21 | not in data | SLV RISING x1, SLV x11, TPAV+SLV x4, BFV-9523 x2, DPCV x1, SLV METAL-9523 x1 | 800 | 29-Mar-2025 |
| 9 | SD24Y-00160 | BLUE STAR LIMITED | ID25Y-15, ID25Y-11 | not in data | SLV x10, SLV-9523 x10, BFV-9523 x7, PRV x7, NRV - 9523 x4, BFV-WAFER x2, NRV x3, TPAV+SLV x4, PRV-9523 x4, BFV x2, SLV METAL-9523 x1 | 152 | 29-Mar-2025 |
| 10 | SD25Y-00012 | BHARAT HEAVY ELECTRICALS LIMITED | ID25Y-65 | not in data | SLV-FORGED x1 | 15 | 15-Apr-2025 |
| 11 | SD25Y-00025 | BLUE STAR LIMITED | ID25Y-26, ID25Y-81, ID25Y-27 | not in data | BFV-9523 x2, NRV x5, NRV - 9523 x4, BFV x8, KGV-WAFER x4, SLV x8, KGV-WAFER-ACT BASE x2, SLV-9523 x1, TPAV+SLV x2, SLV RISING-METAL-9523-GB BASE x1, SLV METAL-9523 x2, SLV METAL x1 | 128 | 16-Apr-2025 |
| 12 | SD25Y-00039 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | SLV RISING-9523-GB BASE x7, NRV - 9523 x5, SLV RISING x3, SLV-9523 x13, SLV RISING-9523 x6, SLV x3, SLV RISING-GB BASE x2, NRV x2 | 189 | 20-May-2025 |
| 13 | SD25Y-00094 | BLUE STAR LIMITED | ID25Y-75, ID25Y-74 | not in data | TPAV+SLV x5, SLV-9523 x3, SLV x3, BFV-9523 x5 | 1333 | 8-Nov-2025 |
| 14 | SD25Y-00112 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | SLV-9523 x4, SLV x4 | 455 | 30-Sep-2025 |
| 15 | SD25Y-00119 | LCC PROJECTS LIMITED | ID25Y-120 | not in data | BFV x7, TPAV+SLV x4, DPCV x3 | 47 | 22-Sep-2025 |
| 16 | SD25Y-00122 | LCC PROJECTS LIMITED | ID25Y-88, ID25Y-100, ID25Y-102, ID25Y-94, ID25Y-99, ID25Y-90 | not in data | SLV x6, SLV METAL x2, TPAV+SLV x5, BFV x12 | 1709 | 19-Sep-2025 |
| 17 | SD25Y-00124 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | TPAV+SLV x3 | 21 | 14-Oct-2025 |
| 18 | SD25Y-00175 | LASER POWER & INFRA LTD. | - | not in data | BALL FLOAT x1, TPAV x1, spare x2, CF x1, SLV RISING-METAL x1, OTHERS x1, PRV x2, globe cs x1, F51010006 x1 | 31 | 17-Jan-2026 |
| 19 | SD25Y-00193 | ZUBERI ENGINEERING CONSTRUCTION PRIVATE LIMITED | - | not in data | TPAV x2 | 70 | 10-Feb-2026 |
| 20 | SD25Y-00197 | ZUBERI ENGINEERING CONSTRUCTION PRIVATE LIMITED | - | not in data | PRV x2, SLV-FORGED x1, NRV x2, BFV-WAFER x1, SLV RISING-METAL x1, GLOBE VALVE x1, BFV x1 | 29 | 13-Feb-2026 |
| 21 | SD25Y-00198 | KRISHNA CONSTRUCTION CO. | - | not in data | BFV CAST STEEL x3, DPCV-CS x1, SLV RISING-CS x2, TPAV+CS SLV x1 | 37 | 20-Feb-2026 |
| 22 | SD25Y-00200 | BLUE STAR LIMITED | - | not in data | SLV x9, TPAV+SLV x2 | 224 | 26-Feb-2026 |
| 23 | SD25Y-00201 | NCC LIMITED | - | not in data | SLV-9523 x3, SLV x2, NRV x3, TPAV+SLV x2 | 152 | 28-Feb-2026 |
| 24 | SD25Y-00202 | NCC LIMITED | - | not in data | SLV x5, SLV-9523 x3, TPAV+SLV x1, TPAV+SLV-9523 x2 | 337 | 2-Mar-2026 |
| 25 | SD25Y-00206 | POWER MECH PROJECTS LTD | - | not in data | TPAV+BFV x1 | 5 | 3-Mar-2026 |
| 26 | SD25Y-00209 | NCC LIMITED | ID26Y-35 | not in data | diaphragm valve x2 | 58 | 5-Mar-2026 |
| 27 | SD25Y-00210 | NCC LIMITED | ID26Y-29 | not in data | SLV METAL x1, diaphragm valve x2 | 63 | 6-Mar-2026 |
| 28 | SD25Y-00211 | NCC LIMITED | ID26Y-30 | not in data | SLV METAL x1, diaphragm valve x2 | 63 | 6-Mar-2026 |
| 29 | SD25Y-00212 | BOKARO STEEL PLANT | - | not in data | SLV METAL RISING-SSRING x1 | 8 | 10-Mar-2026 |
| 30 | SD26Y-00004 | NCC LIMITED | ID26Y-33 | not in data | SLV x11, TPAV+SLV x3 | 209 | 13-Apr-2026 |
| 31 | SD26Y-00007 | AMRUTHA CONSTRUCTION PVT. LTD. | - | not in data | TPAV x5, SLV x2 | 30 | 27-Apr-2026 |
| 32 | SD26Y-00008 | SURYA INTERNATIONAL ENTERPRISE PRIVATE LIMITED | ID26Y-28 | not in data | SLV x5, NRV x5, PRV x5, TPAV x2, ZVV x2 | 714 | 05-May-2026 |
| 33 | SD26Y-00010 | NMDC LIMITED | - | not in data | SLV x1 | 50 | - |
| 34 | SD26Y-00032 | NCC LIMITED | ID26Y-34 | not in data | SLV x2, diaphragm valve x2 | 72 | 28-May-2026 |
| 35 | SD26Y-00034 | KRISHANA INFRACREATIONS PRIVATE LIMITED | - | not in data | TPAV+SLV x2, SLV METAL x4, DPCV x2, BFV x1 | 175 | 30-May-2026 |
| 36 | SD26Y-00035 | KALPATARU PROJECTS INTERNATIONAL LIMITED | ID26Y-22 | not in data | SLV RISING-9523 x4, SLV METAL x1, TPAV+SLV x1, SLV RISING x9, TPAV+RISING SLV x5, TPAV+RISING SLV-9523 x1 | 1373 | 8-Jun-2026 |
| 37 | SD26Y-00039 | BLUE STAR LIMITED | - | not in data | SLV METAL-9523 x4, TPAV+SLV x4, SLV METAL x4 | 51 | 22-Jun-2026 |
| 38 | SD26Y-00042 | NCC LIMITED | - | not in data | BFV x1 | 1 | - |
| 39 | SD26Y-00043 | NCC LIMITED | - | not in data | BFV x1 | 2 | - |
| 40 | SD26Y-00044 | JAIN IRRIGATION SYSTEMS LIMITED | - | not in data | AIR CUSHION x2, SLV METAL x1 | 105 | - |
| 41 | SD26Y-00046 | KALPATARU PROJECTS INTERNATIONAL LIMITED | - | not in data | FSD040001 x1, FSD040050 x1, FSD040084 x1, FSD040044 x1, FSD040038 x1, FSC060011 x1, SLV x1 | 25 | 17-Aug-2026 |
| 42 | SD26Y-00049 | RASHTRIYA ISPAT NIGAM LIMITED | - | not in data | SLV METAL x1 | 5 | - |
| 43 | SD26Y-00051 | LASER POWER & INFRA LTD. | - | not in data | CF x1 | 60 | - |
| 44 | SD26Y-00053 | LUMINO INDUSTRIES LIMITED | - | not in data | SLV x5 | 40 | 26-Sep-2026 |
| 45 | SD26Y-00059 | KALPATARU PROJECTS INTERNATIONAL LIMITED | ID26Y-39 | not in data | SLV x5 | 1294 | 26-Sep-2026 |
| 46 | SD26Y-00063 | LASER POWER & INFRA LTD. | - | not in data | CF x7 | 430 | 09-Sep-2026 |
| 47 | SD26Y-00080 | MERU ENTERPRISES | - | not in data | TPAV x1 | 15 | - |
| 48 | SD26Y-00081 | LASER POWER & INFRA LTD. | - | not in data | globe cs x1 | 1 | - |
| 49 | SF26Y-00004 | LASER POWER & INFRA LTD. | - | not in data | NRV x1, SLV x1, PRV x1 | 14 | - |
