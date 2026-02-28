# Proposed Merchant Auto-Categorization Map

Review below. Each merchant pattern maps to a category and transaction type.
"Pattern" means any merchant name containing that string (case-insensitive).

---

## Fixed costs

| Pattern | Category | Type |
|---|---|---|
| SAMVIRKENDE BOLIGSEL | Rent + utilities | spending |
| DSB | Transport | spending |
| BUS/MRT | Transport | spending |
| GREENMOBILITY | Transport | spending |
| TFL TRAVEL | Transport | spending |
| STANSTED EXPRESS | Transport | spending |
| YOUSEE | Mobile | spending |
| FIBERBY | Internet | spending |
| LOUIS NIELSEN | Contacts | spending |
| HAFNIA-HALLEN | Gym | spending |
| CLASSPASS | Gym | spending |
| KAB | KAB venteliste | spending |

## Subscriptions

| Pattern | Category | Type |
|---|---|---|
| OPENAI | OpenAI | spending |
| APPLE.COM/BILL | iCloud | spending |
| WWW.F1.COM | F1TV | spending |
| EA \*ELECTRONIC ARTS | EA Play Pro | spending |
| MICROSOFT\*MICROSOFT 365 | M365 | spending |
| Google One | Google | spending |
| WHOOP | WHOOP | spending |

## Insurance

| Pattern | Category | Type |
|---|---|---|
| TOPDANMARK | Accident insurance | spending |
| TRYG FORSIKRING | Hövding forsikring | spending |
| SYGEFORSIKRINGEN | Sygesikring Danmark | spending |

## Variable - Groceries

| Pattern | Category | Type |
|---|---|---|
| FOETEX | Groceries | spending |
| FØTEX | Groceries | spending |
| COOP | Groceries | spending |
| REMA1000 | Groceries | spending |
| SPAR | Groceries | spending |
| NEMLIG.COM | Groceries | spending |
| HAMMELSTRUPVEJ FDB | Groceries | spending |
| DAGLI BRUGSEN | Groceries | spending |
| NETTO | Groceries | spending |
| SUPERBRUGSEN | Groceries | spending |
| LABC DEL GUSTO | Groceries | spending |
| MARKS.SPENCER | Groceries | spending |
| SAINSBURY | Groceries | spending |

## Variable - Eating out

| Pattern | Category | Type |
|---|---|---|
| KANTINEN CBS | Eating out | spending |
| Wolt | Eating out | spending |
| PIZZA OTTO | Eating out | spending |
| MIO | Eating out | spending |
| PITANORDIC | Eating out | spending |
| CIBO AMAGER | Eating out | spending |
| CAFE GAVLEN | Eating out | spending |
| CAFE KOB | Eating out | spending |
| CAFE NEXUS | Eating out | spending |
| Original Coffee | Eating out | spending |
| DELPHINE | Eating out | spending |
| GARBANZO | Eating out | spending |
| Mr Ramen | Eating out | spending |
| Kazuki | Eating out | spending |
| DURUM BAR | Eating out | spending |
| Durumbar | Eating out | spending |
| POELSEVOGN | Eating out | spending |
| BAGERDYGTIGT | Eating out | spending |
| KALDEREN | Eating out | spending |
| KUNG FU NOODLE | Eating out | spending |
| BONE DADDIES | Eating out | spending |
| SUBWAY | Eating out | spending |
| MCDVALBY | Eating out | spending |
| MCSVEJK | Eating out | spending |
| SUSHI-TEI | Eating out | spending |
| SILVER BEACH RESORT | Eating out | spending |
| HMSHost | Eating out | spending |
| KABABJI | Eating out | spending |

## Variable - Nightlife

| Pattern | Category | Type |
|---|---|---|
| PS BAR & GRILL | Nightlife | spending |
| JOLENE BAR | Nightlife | spending |
| GLOBE IRISH PUB | Nightlife | spending |
| Bottega Barlie | Nightlife | spending |
| NIGHTPAY | Nightlife | spending |
| BLUME | Nightlife | spending |
| Soho House | Nightlife | spending |
| POOLEN | Nightlife | spending |
| BARKOWSKI | Nightlife | spending |
| SOUND CLUB | Nightlife | spending |
| Cafe Moenten | Nightlife | spending |
| CAFE DAN TURELL | Nightlife | spending |
| Sigurd CPH | Nightlife | spending |
| GOTHERSGADE 35 | Nightlife | spending |
| LOOMISP | Nightlife | spending |
| CHURCHILL ARMS | Nightlife | spending |
| NIKKI BEACH | Nightlife | spending |
| TAXA 4X35 | Nightlife | spending |
| UBR\* PENDING.UBER | Nightlife | spending |
| UBER \*TRIP | Nightlife | spending |
| H9 | Nightlife | spending |
| CE LA VI | Nightlife | spending |
| DONT TRY PTE | Nightlife | spending |
| KILO KITCHEN | Nightlife | spending |
| TST-Village | Nightlife | spending |
| SQ \*VILLAGE | Nightlife | spending |
| DINES\* TRAF | Nightlife | spending |
| The Starman | Nightlife | spending |
| EB \*BEHIND THE GREEN | Nightlife | spending |
| QDF | Nightlife | spending |
| GEBR. HEINEMANN | Nightlife | spending |
| BUKATORE | Nightlife | spending |

## Variable - Other categories

| Pattern | Category | Type |
|---|---|---|
| MATAS | Skincare | spending |
| CHAROENSUK | Skincare | spending |
| WATSONS | Skincare | spending |
| WWW.E-VASKERI | Laundry | spending |
| STENO APOTEK | Pharmacy | spending |
| BILLETLUGEN | Fun | spending |
| WATERSTONES | Fun | spending |
| MATCHi | Fun | spending |
| Vue Entertainment | Fun | spending |
| LOVABLE | Fun | spending |
| Swarovski | Gift cost | spending |
| CPH Airport | Gift cost | spending |
| LAMPHU THAI | Toiletries | spending |
| HOLLAND AND BARRETT | Toiletries | spending |

## Savings / Investments

| Pattern | Category | Type |
|---|---|---|
| Nordnet | Investments | saving |
| ASK invest | Investments | saving |

## Income

| Pattern | Category | Type |
|---|---|---|
| SU | SU | income |
| FK-Feriepenge | Feriepenge | income |

---

## NOT auto-mapped (left for manual tagging)

- **MobilePay to people** (Oliver Myrup, friends, etc.) - too varied, default uncategorized
- **Lars Myrup** - varies between Macbook payment and other
- **Revolut** - varies between groceries and transfer
- **BetalingsService** - generic bill payment, varies
- **UDBETALING DANMARK** - government, varies
- **BOOZT** - could be clothes or gift, varies
- **Lønoverførsel** - part-time job income (but could also be other transfers)
- **GITHUB, INC.** - could be subscription or one-off

## Notes

- "Pharmacy" is a NEW category (not in current list). Needs to be added under Variable.
- "WHOOP" is a NEW subscription (not in current list). Needs to be added under Subscriptions.
- MATAS is mapped to Skincare. In your Excel it sometimes appears as "Vitamins" too. If parents cover vitamins, you can tag those specific ones as covered.
- Uber/Taxa mapped to Nightlife (matches your Excel pattern of late-night rides). Override to Transport if a daytime trip.
- H9 is short - might false-positive. Could make it exact match only.
