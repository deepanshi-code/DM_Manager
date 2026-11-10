# Real labelled messages (not in git)

Put real, **anonymised**, consented customer messages here as `labelled.csv`:

```
text,intent
"price of the black kurta?",price
"received damaged, very upset",complaint
```

- Before saving, remove names, phone numbers, addresses, order IDs and payment details.
- Get the business owner's permission, and keep the data off public GitHub (this folder's CSVs are git-ignored).
- Label using [../../LABELS.md](../../LABELS.md). Ideally two people label the same 50 messages, and you report how often they agree.
- The dashboard export (`/api/labels.csv?corrected=1`) produces this format; its `intent` column already takes agent corrections into account.
