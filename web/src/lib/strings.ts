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
} as const;
