# Design Specification: Remix of AI Sales Pipeline Autopilot

This document outlines the detailed design system tokens, layout hierarchy, components, responsive behavior, and copy content extracted from the **Remix of AI Sales Pipeline Autopilot** project (`projects/751239394424684722`).

---

## 1. Brand Voice & Design Tokens

### Colors (Tailwind Config Reference)

#### Light Mode Tokens
- **Background (`--color-background`):** `#fff8f6` (Warm cream/paper-like tone)
- **Surface (`--color-surface`):** `#fff8f6`
- **Surface Dim:** `#edd5cf`
- **Surface Bright:** `#fff8f6`
- **Surface Container Lowest:** `#ffffff` (Solid white cards)
- **Surface Container Low:** `#fff0ed`
- **Surface Container:** `#ffe9e5`
- **Surface Container High:** `#fce3dd`
- **Surface Container Highest:** `#f6ddd8`
- **On-Surface (`--color-on-surface`):** `#261815` (Deep warm dark navy/slate)
- **On-Surface-Variant:** `#59413c`
- **Primary Color:** `#ae3115` (Surgical rust red/coral)
- **Primary Container:** `#ff6b4a` (Brand active coral orange)
- **Outline:** `#8d716a`
- **Outline Variant:** `#e1bfb8` (Warm pastel outline)

#### Dark Mode Tokens
- **Background (`--color-background`):** `#0B0F19` (Deep Navy Canvas)
- **Surface (`--color-surface`):** `#111827`
- **Surface Dim:** `#0B0F19`
- **Surface Bright:** `#1F2937`
- **Surface Container:** `#171C28`
- **Surface-Container-Low:** `#111827`
- **Surface-Container-Lowest:** `#0B0F19`
- **Primary Color:** `#FF6B4A` (Brand Coral)
- **Primary Container:** `#2D1B17` (Deep dark terracotta/coral)
- **Secondary (`--color-secondary`):** `#94A3B8` (Muted gray for labels)
- **On-Surface (`--color-on-surface`):** `#F9FAFB` (Off-white for text)
- **On-Surface-Variant:** `#9CA3AF` (Muted body copy text)
- **Outline:** `#94A3B8`
- **Outline Variant:** `rgba(255, 255, 255, 0.05)` (5% white outline for thin border borders)

---

### Typography (Inter Font Family)
- **display-lg:** `fontSize: 48px`, `lineHeight: 1.1`, `letterSpacing: -0.02em`, `fontWeight: 700`
- **display-lg-mobile:** `fontSize: 36px`, `lineHeight: 1.2`, `letterSpacing: -0.02em`, `fontWeight: 700`
- **headline-md:** `fontSize: 32px`, `lineHeight: 1.2`, `letterSpacing: -0.01em`, `fontWeight: 600`
- **headline-sm:** `fontSize: 24px`, `lineHeight: 1.3`, `fontWeight: 600`
- **body-lg:** `fontSize: 18px`, `lineHeight: 1.6`, `fontWeight: 300`
- **body-md:** `fontSize: 16px`, `lineHeight: 1.5`, `fontWeight: 300`
- **label-md:** `fontSize: 14px`, `lineHeight: 1.4`, `letterSpacing: 0.01em`, `fontWeight: 500`
- **label-sm:** `fontSize: 12px`, `lineHeight: 1.2`, `fontWeight: 600`

---

### Spacing & Grid Metrics
- **Base Unit:** `8px`
- **Container Width:** Max `1280px` (`max-w-container-max`)
- **Desktop Margins:** `64px` (`px-margin-desktop`)
- **Mobile Margins:** `20px` (`px-margin-mobile`)
- **Section Gaps:** `120px` (`py-section-gap`)
- **Bento Grid Gutters:** `24px` (`gap-gutter`)

---

## 2. Layout & Section Hierarchy

### Section 1: Navigation Bar (Header)
- **Layout:** Flex layout, fixed at top (`fixed top-0 left-0 w-full z-50`), blurred translucent background (`backdrop-blur-md bg-background/80`).
- **Logo (Left):** Callio wordmark (or VoiceFlow logo placeholder in template) with clean typography.
- **Nav Links (Center):** Horizontal row (`hidden lg:flex`): `Features`, `Pricing`, `Blog`, `About`, `Use cases` (with dropdown caret), `Who it's for` (with dropdown caret).
- **CTA Actions (Right):** "Sign In" link button, "Theme Toggle" icon button, and "Get Started" filled action button.

### Section 2: Hero Section
- **Layout:** Grid layout (`grid grid-cols-1 lg:grid-cols-2`), centering marketing narrative on the left and the product dashboard visualizer on the right.
- **Left Column:** Headings, product subheader paragraph, primary button row (Get Started, See Features), and a text-based Stat Strip.
- **Right Column:** Rounded dashboard mockup bordered frame (`bento-card bg-[#1a1e2b] border-white/10`) showcasing the call interface, plus a floating absolute-positioned decoration tag: "Active Agent: Analyzing tone...".

### Section 3: For Sales Teams (Cold Follow-Ups)
- **Layout:** Centered subtitle banner followed by an interactive Horizontal Workflow Diagram (Pill steps connected by arrows) and a 4-column cards grid.
- **Workflow Pills:** Three pill shapes:
  1. `Capture Lead` (Muted/transparent background)
  2. `AI Calls & Qualifies` (Highlighted solid Brand Coral background)
  3. `Book Meeting / Close` (Muted/transparent background)
- **4-Column Sales Grid:**
  - Card 1: **Smart Lead Nurturing** (Mint/Teal gradient glow background)
  - Card 2: **Human-like Conversations** (Rose/Pink gradient glow background)
  - Card 3: **Task & Workflow Types** (Lavender gradient glow background)
  - Card 4: **Zero Setup Friction** (Solid surface-container background with integration code mockup overlay)

### Section 4: For Businesses (Bento Grid Command Center)
- **Layout:** 6-column grid wrapper with asymmetrical column spans (`lg:col-span-3`, `lg:col-span-2`, `lg:col-span-4`) creating a visual dashboard hierarchy.
- **Cards & Accents:**
  1. **Visual Call Flow Builder** (`col-span-3`, Lavender/Purple Glow background, features interactive flow pills).
  2. **Live Call Monitoring** (`col-span-3`, Rose/Pink Glow background, features active transcript lines simulator).
  3. **Team & Agent Management** (`col-span-2`, Green Glow background).
  4. **Dynamic Script Updates** (`col-span-2`, Base solid card gradient background).
  5. **CRM & Tool Broadcast** (`col-span-2`, Blue Glow background).
  6. **Flexible Integrations** (`col-span-2`, Yellow Glow background).
  7. **Real-time Insights** (`col-span-4`, Peach/Orange Glow background, features a 5-bar responsive vertical bar chart).

### Section 5: Pricing Section
- **Layout:** Monthly/Yearly toggle switch followed by a 4-tier cards grid layout.
- **Tier Cards:**
  - **Starter ($49/mo):** Teal/Mint card glow background, transparent outline button.
  - **Growth ($199/mo):** Highlighted card, Rose/Pink card glow background with a thick Coral border outline, solid Coral button, and "Most Popular" floating tag.
  - **Scale ($599/mo):** Lavender card glow background, transparent outline button.
  - **Enterprise (Custom):** Deep dark charcoal background card, solid white button.

### Section 6: Testimonials Section
- **Layout:** Centered header and a 2-column grid.
- **Card Styling:** Transparent backgrounds in dark mode (`var(--color-testimonial-bg)`), displaying only raw quote texts in large italics followed by initials avatar badges.

### Section 7: FAQ Section
- **Layout:** Single column, max-width `3xl` containing accordion buttons.
- **Interactions:** Collapsible answer boxes that expand/collapse on button click with rotating chevron icons.

### Section 8: Final Call to Action (CTA)
- **Layout:** Large full-width banner card with rounded corners (`rounded-[40px]`) and abstract background blur circles (`blur-3xl`).
- **Accent:** Background maps to `bg-primary-container` (Orange in light, Dark Rust in dark).
- **Buttons:** Centered white button ("Get Started Today") and transparent outlined button ("Book a Demo").

### Section 9: Footer
- **Layout:** 6-column list grid mapping brand info (Column 1), product links (Column 2), legal links (Column 3), company links (Column 4), and language selector/developer resources (Column 5).

---

## 3. Screen Text Copy & Content

### Navbar Links
- `Features`, `Pricing`, `Blog`, `About`, `Use cases`, `Who it's for`

### Hero Content
- **Main Heading:** "AI Calling Agents That Actually Close Deals"
- **Subheader:** "Not basic call bots — AI agents that manage tasks, nurture leads, and drive conversions on every call. High-performance voice automation for modern revenue teams."
- **Primary Action Buttons:** `Get Started Today`, `See features`
- **Stat strip:** "10K+ calls handled", "No manual dialing", "3x lead follow-up rate", "Real-time CRM sync"

### Section 3 (Sales Teams)
- **Heading:** "Cold Follow-Ups Are Broken. We Fixed It."
- **Pills:** `Capture Lead` -> `AI Calls & Qualifies` -> `Book Meeting / Close`
- **Card 1 (Smart Lead Nurturing):** "Automatically follow up within 5 seconds of lead capture."
- **Card 2 (Human-like Conversations):** "Natural latency and tone that builds trust instantly."
- **Card 3 (Task & Workflow Types):** "Handle reschedule, surveys, and complex triage flows."
- **Card 4 (Zero Setup Friction):** "Integrate with your current stack in under 10 minutes."

### Section 4 (Bento Command Center)
- **Section Heading:** "Conversion Command Center"
- **Card 1 (Visual Call Flow Builder):** "Drag-and-drop logic to design the perfect conversation path without code."
- **Card 2 (Live Call Monitoring):** "Watch transcriptions in real-time and jump in if a human touch is needed."
- **Card 3 (Team & Agent Management):** "Provision and scale AI agents for specific regions or departments instantly."
- **Card 4 (Dynamic Script Updates):** "Update scripts on the fly and all active agents sync immediately."
- **Card 5 (CRM & Tool Broadcast):** "Automatically push outcomes, summaries, and recordings to your CRM."
- **Card 6 (Flexible Integrations):** "Works with Salesforce, HubSpot, Zapier, and custom API endpoints."
- **Card 7 (Real-time Insights):** "Deep analytics on sentiment, conversion rates, and call duration to optimize every word."

### Section 5 (Pricing Tiers)
- **Monthly/Yearly Switch:** "Monthly", "Yearly (Save 20%)"
- **Starter ($49/mo):** "Up to 100 calls/mo", "Standard Voice Engine" -> `Choose Starter`
- **Growth ($199/mo):** "Up to 1,000 calls/mo", "Premium Natural Latency", "CRM Integrations" -> `Choose Growth` (Most Popular)
- **Scale ($599/mo):** "Unlimited calls", "Custom Voice Training", "Priority 24/7 Support" -> `Choose Scale`
- **Enterprise (Custom):** "Dedicated infrastructure, white-labeling, and advanced compliance for global organizations." -> `Contact Sales`

### Section 6 (Testimonials)
- **Quote 1:** "We replaced our entire SDR outbound team for high-volume leads with VoiceFlow. Our booking rate went from 4% to 12% in the first month." — *Sarah Jenkins, VP Sales @ TechGrowth*
- **Quote 2:** "The human-like quality is actually frightening. Customers have no idea they are talking to an AI agent until we tell them. Truly revolutionary." — *Mark Thompson, CEO @ LeadVelocity*
- **Quote 3:** "Setup took less than an hour. The Zapier integration meant we didn't have to change any of our existing workflows to start seeing results." — *Elena Rodriguez, Operations Director @ FinScale*
- **Quote 4:** "The real-time insights helped us realize our pricing script was confusing customers. We changed it in the dashboard and saw conversions jump." — *David Chen, Head of Growth @ SaaSify*

### Section 7 (FAQs)
- **Q1: How human-like is the voice quality?**
  - *A1: VoiceFlow uses state-of-the-art neural text-to-speech with integrated natural latency and emotional inflection. It sounds virtually indistinguishable from a high-quality VoIP call with a human SDR.*
- **Q2: Does it integrate with my CRM?**
  - *A2: Yes! We offer native integrations for Salesforce, HubSpot, and Pipedrive, plus a robust Zapier app and public API for custom requirements.*
- **Q3: Is it compliant with regulations?**
  - *A3: Yes, VoiceFlow is built with TCPA, GDPR, and HIPAA compliance in mind. We provide tools to manage opt-outs and restricted calling times automatically.*

### Section 8 (Final CTA)
- **Heading:** "Ready to Turn Every Call Into a Conversion?"
- **Action Buttons:** `Get Started Today`, `Book a Demo`

---

## 4. Responsive Behavior Specs
- **Grid breakpoints:** standard Tailwind breaks (`md:` for 768px, `lg:` for 1024px).
- **Navigation:** Main link items (`nav`) hide on viewports smaller than desktop (`hidden lg:flex`), keeping only logo, toggle button, and "Get Started" visible.
- **Bento grids:** Convert to single-column flex/grid stack on mobile viewports, scaling elements to full width (`w-full`) for thumb-friendly interaction layouts.

---

## 5. Assets (Images & Icons)

### Logo References
- **Brand Logo Wordmark:**
  `https://lh3.googleusercontent.com/aida-public/AB6AXuBjqhReomBFFJrW5ertzOp11OUbUetbQ66y-I-VXw07cSDXaLnRmlYoJXppkqh78lNMoec1K5dewJu95j_FtoRzHS-P1rqACPEqRNg2DUnIaHGVTFbMJOhF3AteGFWgRGlmFUCdSRdoIMMcUQvhKtGeYQuALvK-iJcaDDZ_EpZb3jdO-v8Pn_NJDFvPGszca8-TXqHUbDigf31e8wInhshbqLXL3xhx1dZ2JG0GkdU5pcnN8IrYbB7JyoPmOzKS1uoi2rKfp8WEBqDW`

### Page Image Assets
- **Hero Dashboard Screenshot (Dark Mode):**
  `https://lh3.googleusercontent.com/aida-public/AB6AXuB4lmlCJWQ7z4msczhW21FRNDdVutuv_MFZCwvyPCtWtO68KHbWvKO7vO2i_Ch4mfEAtyTfuileoV1YdGH_EQpH7-NEal5RiNCOQrd9m8aq0jH395_vBJ1RuZdM_IAEFNXi2Cx8tS5VVqcv2Slt4oBC4F1s6GJzNLR6zfcDvIWUV2gT1-2wxwwLl2Tg6DQ2jf5ub8nkKbcLhzGSF1FefJ7Z8G3ZyY2au2vamJ-hf6iCfOnJMZ8Atg9yJQ7LKdkhrUwPRKgYdJgmGQrQ`
- **Technical Integration Mockup (Zero Setup Section):**
  `https://lh3.googleusercontent.com/aida-public/AB6AXuDv7xvbi3CRlrBGklW3FB1LHysziLvKWVuC5RMlGzHXAppgLeAXSNDQckG2N8Su-ebtQcg9z14OM2x83FORkV7m6H8CPofM9-3A4k-ikCDT6hpHcqzAozBmTlfnHIV3rN2BAvqD07QN4GCy7enO83aEeHW8_4_mTC5qnelH6c8TXNrYxbWhrwDpSxFFeQLWXWyRf4D_W-9HtIjuu7FoRaTS5SXZST794nNrY5YtSGEtMwn27xAUPylICIA6ACPnynzFvYmmvqZHvhAi`

### Material Symbols (Icons)
- **Arrow right:** `arrow_forward`
- **Filter (Lead Nurturing):** `filter_alt`
- **Speech Bubble (Conversations):** `forum`
- **Checkmark Circle:** `task_alt` / `check_circle`
- **Caret expand/dropdown:** `expand_more`
- **Internet Globe (Social/Public):** `public`
- **Email (Social/At-sign):** `alternate_email`
- **Language Globe (Footer):** `language`
- **Phone (Floating active widget):** `call`
- **Call flow arrow:** `trending_flat`

