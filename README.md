# Mayor Invoice Generator

A server that generates Mayor-branded invoice PDFs from HubSpot deal data.

## Deploy to Render

1. Push this repo to GitHub
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects the render.yaml config
5. Deploy — you'll get a URL like `https://mayor-invoice.onrender.com`

## HubSpot Setup

1. In HubSpot, go to Settings → Integrations → Private Apps
2. Create a private app with these scopes:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
3. Copy the token

## API Usage

POST to `/generate` with this JSON body:

```json
{
  "order_number": "Oklahoma City Golf & Country Club I",
  "club": "Oklahoma City Golf & Country Club",
  "address": "Oklahoma City Golf & Country Club, Attn: Tim Fleming, 7000 N.W. Grand Blvd, Oklahoma City, Ok. 73116",
  "ship_date": "Friday, May 29, 2026",
  "payment_link": "https://nickel.com/pay/xxx",
  "line_items": [
    {
      "product": "Custom Print Polo",
      "url": "https://mayorclothing.com/products/xxx",
      "description": "Colors: Thunder Blue icons on White golf shirt\nIcons: 1911\nStyle: Chain\nS: 2 - M: 8 - L: 8 - XL: 4 - XXL: 2\nLeft Chest Embroidery: Oklahoma City Golf & Country Club regular club logo in Thunder Blues",
      "quantity": 24,
      "price": 67,
      "amount": 1608
    }
  ],
  "subtotal": 4824,
  "embroidery": 288,
  "art_setup": 1000,
  "shipping": 149,
  "total": 4973
}
```

Returns a PDF file.
