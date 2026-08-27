/**
 * Central home for user-facing copy.
 *
 * Every string a user sees — page copy, labels, error/status messages —
 * should be added here rather than inlined at the call site. This keeps the
 * app i18n-ready: a future translation layer only needs to swap out this
 * one module (or the values it exports) per locale.
 */
export const strings = {
  app: {
    name: "CorruptionFix",
    tagline: "Report corruption at government offices. See it on the map.",
  },
  health: {
    ok: "All systems operational.",
    degraded: "Service is degraded — the database is unreachable.",
  },
  auth: {
    otpEmail: {
      subject: "Your CorruptionFix verification code",
      body: (code: string) =>
        `Your CorruptionFix verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    },
    errors: {
      invalidEmail: "Enter a valid email address.",
      invalidCode: "Enter the 6-digit code we emailed you.",
      rateLimited: "Too many attempts. Please try again later.",
      cooldown: "Please wait before requesting another code.",
      codeNotFound: "Request a new code first.",
      codeExpired: "That code has expired. Request a new one.",
      codeIncorrect: "That code isn't right. Check your email and try again.",
      tooManyAttempts: "Too many incorrect attempts. Request a new code.",
      badOrigin: "Request rejected.",
      serverError: "Something went wrong. Please try again.",
    },
  },
  report: {
    meta: {
      title: "Report an incident",
    },
    intro:
      "Tell us what happened. Your report is recorded in a tamper-evident log the moment you submit it, and you choose exactly how it can be used before anything is published.",
    auth: {
      heading: "Verify your email to continue",
      body: "We use a one-time code to confirm you're a real person and to let you follow up on this report later. We never publish your email address.",
      emailLabel: "Email address",
      emailPlaceholder: "you@example.com",
      sendCodeButton: "Send code",
      sendingCode: "Sending…",
      codeLabel: "6-digit code",
      codePlaceholder: "000000",
      codeSentTo: (email: string) => `We sent a code to ${email}.`,
      verifyButton: "Verify",
      verifying: "Verifying…",
      resendButton: "Resend code",
      changeEmailButton: "Use a different email",
    },
    details: {
      heading: "What happened",
      serviceTypeLabel: "What service were you trying to access?",
      serviceTypePlaceholder: "e.g. passport renewal, FIR registration, land record copy",
      bribeAmountLabel: "Amount demanded (₹, optional)",
      bribeAmountHint: "Leave blank if no specific amount was named.",
      designationLabel: "Officer's designation (optional)",
      designationPlaceholder: "e.g. constable, clerk, sub-inspector",
      officerNameLabel: "Officer's name (optional)",
      officerNameHint:
        "This stays private. Names are only ever published after multiple independent, verified reports name the same person — a single report never identifies anyone publicly.",
      narrativeLabel: "What happened",
      narrativeHint: "Between 30 and 5,000 characters. Stick to what you directly experienced.",
      continueButton: "Continue",
    },
    consent: {
      heading: "Choose how this can be used",
      body: "This choice is yours alone. It only controls what gets published — your report is recorded either way, and you can request removal later if your circumstances change.",
      tiers: {
        publish_named: {
          label: "Publish, and name the officer once corroborated",
          description:
            "Your report can be published (without your identity). If enough independent, verified reports name the same officer, that name is published too.",
        },
        publish_anon: {
          label: "Publish, office only",
          description:
            "Your report can be published against this office, without your identity and without any officer name ever being attached to it.",
        },
        escalate_only: {
          label: "Don't publish — escalate only",
          description:
            "Your report is kept out of public view entirely. It's still recorded and can be used for oversight escalation, not for the public map.",
        },
      },
      submitButton: "Submit report",
      submitting: "Submitting…",
    },
    success: {
      heading: "Report received",
      body: (complaintId: string) => `Your report has been recorded. Reference ID: ${complaintId}`,
      whatNextHeading: "What happens next",
      whatNext: [
        "Your report is immediately appended to the tamper-evident public log, with your consent choice attached.",
        "If you chose to publish, moderators review it before it appears on the office page.",
        "Officer names are only attached once multiple independent, verified reports corroborate the same person.",
        "You can verify your report was recorded correctly, without trusting us, on the Transparency page.",
      ],
      backToOffice: "Back to office page",
      viewTransparency: "See how this is verified",
    },
    errors: {
      notAuthenticated: "Verify your email before submitting a report.",
      officeNotFound: "We couldn't find that office. Go back and pick it from the map.",
      invalidBody: "Some of the details you entered aren't valid. Please check the form and try again.",
      rateLimited: "You've submitted several reports recently. Please try again later.",
      badOrigin: "Request rejected.",
      serverError: "Something went wrong. Please try again.",
    },
  },
  map: {
    title: "Map",
    searchPlaceholder: "Search offices by name…",
    searchNoResults: "No offices found.",
    searchLoading: "Searching…",
    legendTitle: "Categories",
    addMissingOffice: "Add missing office",
    viewOffice: "View office →",
    loadingOffice: "Loading…",
    officeUnavailable: "Office details unavailable.",
    loadingMap: "Loading map…",
    categories: {
      police: "Police station",
      post_office: "Post office",
      court: "Court",
      govt_office: "Government office",
      rto: "RTO",
      other: "Other",
    } as const,
    errors: {
      invalidBbox: "Invalid map area.",
      invalidQuery: "Enter a search term.",
      invalidOsmUid: "Invalid office reference.",
      notFound: "Office not found.",
      serverError: "Something went wrong. Please try again.",
    },
  },
  office: {
    backToMap: "← Back to map",
    viewOnMap: "View on map →",
    stats: {
      complaintCount: "Complaints filed",
      topService: "Most reported service",
      medianBribe: "Median reported amount",
      lastActivity: "Last reported",
      noStatsYet:
        "No complaints have been reported at this office yet. Be the first to report one.",
    },
    officersTitle: "Published officers",
    noOfficersYet: "No officers have been published for this office yet.",
    complaintsTitle: "Published complaints",
    noComplaintsYet:
      "No complaints have been published for this office yet.",
    reportCta: "Report corruption at this office",
    fileOfficially: {
      title: "File it officially",
      body: "You can also file a formal grievance with the Government of India's Centralized Public Grievance Redress and Monitoring System (CPGRAMS).",
      link: "Go to CPGRAMS →",
      phaseNote:
        "Office-specific filing guidance for this office is coming in a future update.",
    },
    errors: {
      invalidId: "Invalid office reference.",
      notFound: "Office not found.",
    },
  },
  addOffice: {
    title: "Add a missing office",
    intro:
      "Can't find an office on the map? Pin its location and add a few details below.",
    nameLabel: "Office name",
    namePlaceholder: "e.g. Sector 14 Police Station",
    categoryLabel: "Category",
    addressLabel: "Address (optional)",
    addressPlaceholder: "e.g. MG Road, near City Hospital",
    pinInstructions: "Click or drag the pin to the office's location.",
    submit: "Submit office",
    submitting: "Submitting…",
    success: "Office added. Thanks for helping map it!",
    viewOfficeLink: "View office →",
    addAnother: "Add another office",
    loginRequired: "Sign in to add an office.",
    loginEmailLabel: "Email address",
    loginEmailPlaceholder: "you@example.com",
    loginSendCode: "Send code",
    loginSending: "Sending…",
    loginCodeLabel: "6-digit code",
    loginVerify: "Verify & continue",
    loginVerifying: "Verifying…",
    loginCodeSent: (email: string) => `We sent a code to ${email}.`,
    errors: {
      nameRequired: "Enter the office's name.",
      categoryRequired: "Choose a category.",
      locationRequired: "Set a location on the map.",
      invalidBody: "Check the office details and try again.",
      unauthorized: "Sign in to add an office.",
      rateLimited:
        "You've added the maximum number of offices for today. Try again tomorrow.",
      badOrigin: "Request rejected.",
      serverError: "Something went wrong. Please try again.",
    },
  },
  transparency: {
    meta: {
      title: "Transparency",
    },
    intro:
      "Every report submitted to CorruptionFix is recorded in an append-only, tamper-evident log. This page explains how that log works and lets anyone — not just us — independently verify that a specific report hasn't been silently altered.",
    chain: {
      heading: "The hash chain",
      body: "Each report becomes one entry in a chain. Every entry's hash is computed from its own content plus the previous entry's hash, so altering, reordering, or deleting any entry changes every hash that comes after it — the break is visible to anyone who recomputes the chain, not just to us.",
    },
    checkpoints: {
      heading: "Signed checkpoints",
      body: "Periodically, the current end of the chain is cryptographically signed with a private key we don't expose, and the signature is published here. Because the signature can only have been produced with that key, a checkpoint is a durable, independently-checkable anchor — proof that the chain looked exactly this way at this point in time.",
      tableHeading: "Checkpoint history",
      colRange: "Entries",
      colHead: "Head hash",
      colDate: "Signed",
      colSignature: "Signature",
      empty: "No checkpoints have been signed yet.",
      publicKeyLabel: "Public key (for independent verification)",
      publicKeyMissing: "No public key is currently published.",
    },
    tombstones: {
      heading: "Tombstoned entries",
      body: "Reports are occasionally removed from public view — for example, in response to a valid legal order. When that happens, the chain entry is never deleted; instead it's marked as removed, with a reason and reference, so the removal itself is part of the permanent, visible record rather than a silent edit.",
      colSeq: "Entry",
      colDate: "Removed",
      colReason: "Reason",
      colOrderRef: "Order reference",
      empty: "No entries have been removed.",
    },
    verify: {
      heading: "Verify a report",
      body: "Enter a report's reference ID to fetch its proof and recompute its hashes in your own browser — nothing here is taken on trust.",
      inputLabel: "Report reference ID",
      inputPlaceholder: "e.g. 018f2e2a-...",
      buttonLabel: "Verify",
      verifying: "Verifying…",
      pass: "Verified — this entry's hash and its position in the signed chain check out.",
      passUnanchored:
        "This entry's hash chains back to genesis correctly, but no signed checkpoint covers it yet.",
      fail: "Verification failed — the recomputed hash doesn't match. This should never happen; please report it.",
      notFound: "No report found with that reference ID.",
      error: "Couldn't fetch or verify that report right now.",
    },
  },
} as const;
