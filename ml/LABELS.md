# Labelling guide: DM intent

Every **customer message** gets exactly one label. Label the message *as written*, without guessing what the customer meant earlier in the chat. Conversation context (for example, "this 'hi' is really a nudge because they've waited 2 hours") is handled by rules in the server, not by the label.

Two people labelling the same message should agree. If you find yourself unsure, follow the tie-break rules at the bottom and write the case down. Ambiguous cases are useful to discuss in your report.

| Label | Meaning | Examples |
|---|---|---|
| `price` | Asks the cost, rate or discount | "pp", "kitna ka hai", "price of the kurta?", "any discount?" |
| `size` | Size, fit, measurements, size chart | "M size hai?", "will XL fit a 32 waist", "size chart pls" |
| `availability` | In stock, restock, colour available | "is this back in stock", "maroon milega?", "sold out?" |
| `cod_shipping` | Payment method, delivery area, delivery time or cost *before* ordering | "COD available?", "do you deliver to Dehradun", "shipping free?" |
| `order_status` | Where an *existing* order is, tracking, dispatch | "order 12345 kab aayega", "tracking link not working" |
| `return_exchange` | Asks how to return, exchange or get a refund (the process) | "exchange possible?", "refund status?", "return policy?" |
| `complaint` | Expresses dissatisfaction or a problem with product or service | "received damaged", "wrong colour bheja", "worst quality" |
| `collab` | Creators, influencers, agencies proposing work | "collab?", "PR package bhej sakte ho", "paid promotion?" |
| `spam` | Unrelated promotion, scams, follower selling | "get 10k followers", "you won a giveaway, click link" |
| `greeting` | Greeting, compliment or thanks with **no request** | "hi", "love this 😍", "thank you" |
| `follow_up` | Chasing a reply, with no new question | "??", "hello??", "please reply", "anyone there?" |

At prediction time the system may also output **`unclassified`** when the model's confidence is below the threshold. This is not a label you assign. It means "a human should look at this".

## Tie-break rules (apply in this order)
1. **Complaint wins.** If the customer is unhappy *and* asks something ("wrong size sent, how do I return?"), label it `complaint`. Missing an angry customer is the most expensive mistake.
2. **Spam and collab** are about who is writing, not the product. Label them even if a product is mentioned.
3. **Existing order vs. new order.** "When will it arrive?" about something already bought is `order_status`; "how many days to Pune?" before buying is `cod_shipping`.
4. **A size mentioned means `size`.** "M available?" is `size`; "available?" alone is `availability`.
5. **Request beats greeting.** "Hi, price?" is `price`. Greeting is only for messages with nothing to answer.
6. **Follow-up has no new content.** "Any update on my order?" is `order_status`; "any update??" alone is `follow_up`.

## Known limits
- Messages written in Devanagari script (हिंदी) are not handled by the current tokenizer: only Latin letters, digits and ?/! are used. Hinglish in Latin script is handled.
- Emojis are ignored. "😍😍" alone becomes an empty message and is predicted from the empty-message feature.
