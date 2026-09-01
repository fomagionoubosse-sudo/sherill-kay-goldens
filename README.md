# Sherill Kay Golden Retriever Website

This project includes a Golden Retriever breeder homepage, puppy listings, admin dashboard, SMS/email contact buttons, email verification password reset, SQLite storage, and Render Persistent Disk support.

## Render setup
1. Create a paid Render Web Service.
2. Add a Persistent Disk mounted at `/var/data`.
3. Set `DATA_ROOT=/var/data`.
4. Set a long random `SESSION_SECRET`.
5. Set `ADMIN_EMAIL` and an initial `ADMIN_PASSWORD`.
6. Configure SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) for forgot-password email.

The app stores its database at `/var/data/data/site.db` and uploaded files at `/var/data/uploads/`, so admin changes and images survive restarts.
