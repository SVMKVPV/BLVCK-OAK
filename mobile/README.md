# BLVCK OAK iOS app

Status: planning scaffold; no iOS binary or App Store submission yet.

## Architecture
- Expo + React Native + TypeScript iOS application, native navigation and screens.
- Reuse existing BLVCK OAK and BLVCK OAK Automate APIs where suitable; audit endpoints and authorization before integration.
- Two roles: customer and administrator, with server-enforced permissions (never rely on hidden UI alone).
- Customer: sign in, service catalogue, automation discovery, quotes, bookings, marketplace and order status.
- Admin: enquiries, quotes, bookings, automation status, revenue summaries and notifications.
- Authentication: secure token storage; biometric unlock only after a valid authenticated session.
- Payments: evaluate Apple in-app purchase requirements for digital goods/features; Stripe for eligible real-world services. No live payment tests without safeguards.
- Push notifications: opt-in, scoped to the correct account; avoid sensitive payloads.

## Release gates
1. Inventory API contracts and identify missing endpoints.
2. Implement navigation, auth and role-protected screens.
3. Test on iPhone using Expo development build/TestFlight.
4. Verify privacy policy, account deletion, data handling, and App Store review requirements.
5. Obtain Apple Developer account access and signing approval before App Store submission.

Do not publish or change production website behavior as part of this planning commit.
