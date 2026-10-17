# TradeZora

TradeZora is a web-based trading dashboard prototype.

## Features

- Trading dashboard interface
- Live market charts and prices
- Demo trading interface
- Account and profile pages
- Positions and trading history
- Deposit and withdrawal interfaces
- M-PESA payment integration through the existing backend

## Technologies

- HTML
- CSS
- JavaScript
- GitHub
- Supabase (planned integration)

## Current Status

The existing dashboard still uses the current Render backend for account and payment requests. Supabase has not yet replaced that backend.

The existing dashboard should remain unchanged until the Supabase replacement has been configured and tested.

## Security

- Never upload passwords, API secrets, M-PESA credentials, or Supabase service-role keys to GitHub.
- Verify deposits and withdrawals securely on the server.
- Keep demo balances separate from real-money balances.
- Never credit real balances from unverified payment callbacks.

## Setup

1. Place the dashboard HTML file in the repository root.
2. Rename the file to `index.html`.
3. Upload this `README.md` file to the same repository.
4. Commit both files to GitHub.

## Planned Work

- Configure the Supabase database.
- Set up authentication and row-level security.
- Implement secure server-side functions.
- Test account, deposit, and withdrawal flows before migrating away from Render.

**Project status:** Under development.
