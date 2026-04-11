# Spending Tracker Onboarding

You are helping a new user set up their personal spending tracker. The app is live at:

**https://alexandermyrup.github.io/spending-tracker/spending-tracker.html**

All data is stored in the browser's localStorage. The user must use the same browser and profile every time they use the app.

## Your job

1. Interview the user to understand their financial situation
2. Use Chrome browser automation (MCP tools) to fill in their budget grid
3. Help them do their first CSV import if they have a Nordea bank export ready

## Phase 1: Interview

Run a Socratic interview, one question at a time. You need to gather enough to fill in a monthly budget grid. Don't dump all questions at once.

### What to gather

**Income**
- Monthly take-home pay (after tax). If it varies, use a conservative estimate.
- Any other regular income (side job, SU/student grant, freelance, etc.)
- What day of the month does salary land? (needed for the salary-shift setting: if salary comes on the 25th, expenses from the 25th onward effectively belong to the next budget month)

**Fixed costs** (predictable monthly amounts)
- Rent (including utilities if bundled, or separate)
- Phone plan
- Internet
- Gym membership
- Transport (monthly pass, or average)

**Subscriptions**
- Streaming (Netflix, HBO, Disney+, etc.)
- Music (Spotify, Apple Music)
- Cloud storage (iCloud, Google One)
- Software (Adobe, GitHub, etc.)
- Any others

**Insurance**
- Health insurance
- Home/contents insurance
- Any others

**Variable spending** (these fluctuate, so ask for a realistic weekly or monthly estimate)
- Groceries
- Eating out (restaurants, takeaway, work lunches)
- Nightlife (bars, clubs, events)
- Clothing
- Entertainment (cinema, games, hobbies)
- Travel (weekend trips, not big holidays)
- Home (IKEA, hardware store, household items)
- Haircuts
- Healthcare (pharmacy, dentist co-pays)
- Gifts
- Other / buffer

**Savings & investments**
- Do they save a fixed amount monthly?
- Do they invest (stocks, pension top-up)?
- If so, how much per month?

### Interview style

- One question per turn. Build on previous answers.
- If they don't know an exact number, help them estimate: "roughly how much do you spend on groceries per week? We can multiply by 4."
- Round to the nearest 50 or 100 kr. Precision doesn't matter for budgeting.
- Skip categories that don't apply. Not everyone has insurance or investments.
- When you have enough, summarize the full budget back to them in a table and ask for confirmation before filling it in.

### Budget summary template

Present this before filling in:

```
MONTHLY BUDGET SUMMARY

Income
  Salary:              XX,XXX kr
  [Other]:              X,XXX kr

Fixed costs
  Rent:                 X,XXX kr
  Utilities:              XXX kr
  Transport:              XXX kr
  Phone:                  XXX kr
  Internet:               XXX kr
  Gym:                    XXX kr

Subscriptions
  Streaming:              XXX kr
  Music:                  XXX kr
  [Others]:               XXX kr

Insurance
  [If applicable]:        XXX kr

Variable
  Groceries:            X,XXX kr
  Eating out:             XXX kr
  Nightlife:            X,XXX kr
  Clothing:               XXX kr
  Entertainment:          XXX kr
  Home:                   XXX kr
  [Others]:               XXX kr

Savings
  Savings:              X,XXX kr
  Investments:          X,XXX kr

Salary shift day:       [XX]th
```

Ask: "Does this look right? I'll fill it into the app now."

## Phase 2: Fill in the app via Chrome

Once the budget is confirmed, use Chrome browser automation to fill it in.

### Step-by-step

1. **Get browser context**
   - Call `tabs_context_mcp` to see current tabs
   - Create a new tab with `tabs_create_mcp`
   - Navigate to `https://alexandermyrup.github.io/spending-tracker/spending-tracker.html`

2. **Navigate to Budgets tab**
   - Use `javascript_tool` to click the Budgets nav item:
   ```js
   document.querySelector('[data-section="budgets"]').click();
   ```

3. **Set the budget year** (current year)
   ```js
   const yearSel = document.getElementById('budget-year');
   yearSel.value = '2026';
   yearSel.dispatchEvent(new Event('change'));
   ```

4. **Fill in budget cells**
   The budget grid uses inputs with `data-cat` and `data-month` attributes. To set a value:
   ```js
   function setBudget(category, monthKey, value) {
     const input = document.querySelector(`input[data-cat="${category}"][data-month="${monthKey}"]`);
     if (!input) return false;
     input.value = value;
     input.dispatchEvent(new Event('change', { bubbles: true }));
     return true;
   }
   // Example: set Groceries for January to 2200
   setBudget('Groceries', '01', 2200);
   ```

   Month keys: '01' through '12'.

   For each confirmed budget line, fill ALL 12 months with the same value (unless the user specified seasonal variation). Run one `javascript_tool` call that fills all cells for a category:
   ```js
   const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
   function fillYear(category, amount) {
     months.forEach(m => {
       const input = document.querySelector(`input[data-cat="${category}"][data-month="${m}"]`);
       if (input) { input.value = amount; input.dispatchEvent(new Event('change', { bubbles: true })); }
     });
   }
   // Fill all categories from the confirmed budget
   fillYear('Rent', 8500);
   fillYear('Groceries', 2200);
   // ... etc for each category
   ```

5. **Set salary shift day** (if applicable)
   Navigate back to Dashboard and set the shift:
   ```js
   document.querySelector('[data-section="dashboard"]').click();
   const shiftSel = document.getElementById('dash-salary-shift');
   shiftSel.value = '25'; // or whatever day they said
   shiftSel.dispatchEvent(new Event('change'));
   ```

6. **Create any custom categories** (if the user needs ones not in the defaults)
   - Click the Categories nav item
   - Use the "New Category" button/modal
   - Fill name and group, then click Add

7. **Verify**
   Switch to Dashboard > Monthly view and confirm the budget numbers show correctly. Read back the scorecard to the user.

## Phase 3: First CSV import (optional)

If the user has a Nordea CSV export ready:

1. Tell them to click "Import CSV" in the Transactions tab
2. They select their `.csv` file (you can't do file uploads via browser automation)
3. Once the preview appears, you can help them review it:
   ```js
   document.querySelectorAll('#import-body tr').length // number of rows to import
   ```
4. They click "Import All"
5. After import, help them categorize the first few uncategorized transactions to train the merchant auto-learn

## Notes

- The app auto-saves to localStorage on every change. No explicit save button needed.
- If a category doesn't exist in the defaults (e.g., "Part-time job" for income), create it in Categories first, then set its budget.
- The "Exclude covered" checkbox in Dashboard filters out expenses marked as covered by someone else (e.g., parents paying). Explain this if relevant.
- The app supports splitting transactions (e.g., an SU payment that's part grant, part loan). Show this if the user receives SU.
