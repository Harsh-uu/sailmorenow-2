# Cross-Platform Blueprint: Web to Mobile

## Detection
- **Source Platform**: Web (React, Tailwind, React Router) — located in `/app/frontend/`.
- **Target Platform**: Mobile (Expo, React Native, Expo Router) — to be built in `/app/mobile/`.
- **Evidence**: `/app/frontend` contains a fully built React application (`src/App.js` with full routing, components, etc.). `/app/mobile` contains a blank Expo project with a placeholder `index.tsx`.

## Existing App Map (Web)
**Screens & Routes:**
- `/` -> Landing Page
- `/auth/callback` -> AuthCallback
- `/onboarding` -> Onboarding flow
- `/dashboard` -> Dashboard
- `/directory` -> Directory (Markets, Categories)
- `/directory/:id` -> DirectoryDetail
- `/feed` -> Feed
- `/events` -> Events
- `/my-events` -> MyEvents
- `/partners/:handle` -> PartnerEvents
- `/crew-bank` -> CrewBank
- `/reviews` -> Reviews
- `/digest` -> DigestPreview
- `/community-hub` -> CommunityHub
- `/community-hub/:id` -> DiscussionDetail
- `/pricing` -> Pricing
- `/payment/success` -> PaymentSuccess
- `/messages` -> Messages
- `/profile` -> Profile
- `/contact` -> Contact
- `/u/:handle` -> HandleProfile (Public profile alias /@handle)
- `/admin/*` -> Admin routes (Events, Reports, Analytics, Contact)

**Key UI Components:**
- Modals, Forms, Navigation Header/Footer.
- LiveNowWidget, EventCalendar, EventMap, OpenCrewSlots, ProPhotosUploader, PushPreferencesPanel, MutualReviewForm.

**User Flows:**
1. **Auth & Onboarding:** Authenticate via web auth session, agree to policies, select account type, specify markets.
2. **Directory & Pros:** Users can browse boat pros, filter by market/category, view profiles, and leave reviews.
3. **Community & Events:** Users view/post community posts (sailing opportunities), view events, register for events, and use the crew bank.
4. **Messaging:** Real-time DM messaging via WebSockets.
5. **Monetization (Stripe):** Pricing page leading to Stripe Checkout for subscription tiers.

## Shared Backend API Surface
The backend API is located in `/app/backend` and all endpoints use the `/api` prefix. The mobile app MUST consume these exact endpoints.

**Auth & Users**
- `POST /api/auth/session` (creates session via emergent token)
- `GET /api/auth/me` (get current user)
- `GET /api/auth/ws-token` (get token for websocket connection)
- `POST /api/auth/logout`
- `PATCH /api/auth/handle`
- `PATCH /api/auth/newsletter`
- `PATCH /api/auth/account-type`
- `PATCH /api/auth/onboarding`

**Directory**
- `GET /api/markets` (list markets, categories, reasons)
- `POST /api/markets/request`
- `GET /api/crew-positions`
- `GET /api/boat-pros` (list directory profiles)
- `GET /api/boat-pros/mine`
- `GET /api/boat-pros/{pro_id}`
- `PATCH /api/boat-pros/photos`
- `POST /api/boat-pros` (upsert profile)
- `GET /api/u/{handle}` (public profile)
- `GET /api/reviews` & `POST /api/reviews`
- `POST /api/contact`

**Community (Posts & Events)**
- `GET /api/posts` & `POST /api/posts`
- `POST /api/posts/{post_id}/extend`
- `GET /api/events` & `POST /api/events`
- `PATCH /api/events/{event_id}`

**Messaging (REST + WebSocket)**
- `GET /api/messages/threads`
- `GET /api/messages/{thread_id}`
- `POST /api/messages/{thread_id}/read`
- `POST /api/messages/{recipient_id}` (send DM)
- `WS /api/ws/{user_id}?token={session_token}`

**Payments & Notifications**
- `GET /api/payments/packages` & `GET /api/payments/mode`
- `POST /api/payments/checkout` (create Stripe session)
- `GET /api/payments/status/{session_id}`
- `GET /api/notifications`
- `PATCH /api/notifications/{notif_id}/read`
- `POST /api/notifications/mark-all-read`
- `GET /api/activity/{user_id}`

*(Note: Admin endpoints like `/api/admin/*`, reports, ipban, identity etc. exist but can potentially be excluded from the initial mobile port if admin tasks are primarily web-based. To be confirmed.)*

## Data Models & Integrations
- **Database**: MongoDB (users, sessions, boat_pros, posts, events, dm_threads, reviews, etc.)
- **Integrations**:
  - **Emergent Auth**: The web app uses a pop-up/redirect flow to `EMERGENT_AUTH_SESSION_URL`. The mobile app will need to use `expo-auth-session` or `react-native-webview` to handle this OAuth-like flow.
  - **Stripe Payments**: Web uses `StripeCheckout` leading to Stripe hosted pages. Mobile must use `expo-linking` for deep linking back to the app on success/cancel, or use a WebView to open the checkout session.
  - **Zoho / Resend**: Backend-handled, no special mobile frontend handling required other than standard API calls.

## Port Requirements (Target Platform: Mobile)
**General Mobile Architecture:**
- **Framework**: Expo Router (`app/`).
- **Styling**: React Native `StyleSheet` or NativeWind (if preferred/available). No Web Tailwind unless specifically configured.
- **Environment**: Use `EXPO_PUBLIC_BACKEND_URL` instead of `REACT_APP_BACKEND_URL`.
- **Navigation**: Replace React Router `<Link>` with `expo-router` `<Link>` or `router.push()`. Use Stack and Tabs layouts for mobile navigation patterns (e.g., bottom tabs for Feed, Events, Directory, Messages, Profile).

**Screen-by-Screen Breakdown:**
- **Auth Flow**: `app/index.tsx` (Landing) -> Auth Webview/Browser -> `app/auth/callback.tsx` -> `app/onboarding.tsx`.
- **Bottom Tabs (`app/(tabs)/_layout.tsx`)**:
  - **Feed (`app/(tabs)/feed.tsx`)**: Port `/feed`. Lists posts. Use `FlatList` with `RefreshControl`.
  - **Events (`app/(tabs)/events.tsx`)**: Port `/events`. Show event calendar and list. Use React Native date picker and maps (e.g., `react-native-maps`).
  - **Directory (`app/(tabs)/directory.tsx`)**: Port `/directory`. Search and filter boat pros.
  - **Messages (`app/(tabs)/messages.tsx`)**: Port `/messages`. List message threads.
  - **Profile (`app/(tabs)/profile.tsx`)**: Port `/dashboard` / `/profile`.
- **Modals / Sub-screens**:
  - **Event Detail**: `app/events/[id].tsx`
  - **Directory Detail**: `app/directory/[id].tsx`
  - **Chat Thread**: `app/messages/[id].tsx`. Uses `WebSocket` (standard JS API works in RN). Needs `KeyboardAvoidingView`.
  - **Pricing / Checkout**: `app/pricing.tsx`. Call `POST /api/payments/checkout`, open the returned URL in `WebBrowser.openAuthSessionAsync` or `Linking.openURL`, then handle the return deep link in `app/payment/success.tsx`.
  - **Public Profile**: `app/u/[handle].tsx`.

**Mobile-Specific Notes:**
- **Safe Area**: Wrap top-level screens in `SafeAreaView` from `react-native-safe-area-context`.
- **Image Uploads**: Replace web HTML5 `<input type="file">` with `expo-image-picker` for Avatar and Pro Photos. Image payload must be base64 data URLs as expected by backend or uploaded to a presigned URL (if standard). Backend seems to accept `photos` array of strings (likely data URLs or external URLs).
- **Keyboard Handling**: Apply `KeyboardAvoidingView` for chat screens (`Messages`) and forms (`Onboarding`, `Contact`, `PostCreate`).
- **Maps**: `EventMap` requires `react-native-maps` instead of Google Maps web JS API.

## Open Questions / Risks
1. **Admin Screens on Mobile**: Should `/admin/*` screens be ported to mobile, or are they web-exclusive for platform administrators? (Recommendation: Skip for mobile MVP).
2. **Auth Integration**: Handling emergent auth on mobile requires specific redirect URIs configured in the Auth provider. Are custom schemes (e.g., `exp://` or app scheme) authorized?
3. **Stripe Deep Linking**: Handling Stripe success/cancel redirects on mobile requires setting the correct deep link scheme for the app in app.json and passing it to the backend `origin_url` in checkout.
4. **Push Notifications**: Web uses a `PushPreferencesPanel`. Mobile would typically use Expo Push Notifications instead of web service workers. Backend currently lacks mobile push token registration endpoints (only `GET /api/notifications`). Mobile push may require backend additions if not already supported.