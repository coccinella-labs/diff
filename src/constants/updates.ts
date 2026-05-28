export interface AppUpdate {
  version: string;
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'fix' | 'planned';
  details: string[];
}

export const APP_UPDATES: AppUpdate[] = [
  {
    version: "0.7.5",
    title: "Icon Polish",
    description: "App and docs icons stay consistent.",
    category: "fix",
    details: [
      "Use local sign assets for app chrome and favicon",
      "Keep README logos readable across GitHub themes",
      "Keep the Gemini key server-only"
    ]
  },
  {
    version: "0.7.4",
    title: "Check Logs",
    description: "Check run logs stay steady while refreshing.",
    category: "fix",
    details: [
      "Keep current check details during polling",
      "Avoid repeated log loading states",
      "Clear stale loading state when switching checks"
    ]
  },
  {
    version: "0.7.3",
    title: "Schema Cleanup",
    description: "Preference setup is simpler for new projects.",
    category: "fix",
    details: [
      "Keep preference columns in the base schema",
      "Leave old migrations for existing projects",
      "Use clearer setup messages"
    ]
  },
  {
    version: "0.7.2",
    title: "Loading Cleanup",
    description: "PR screens stay steady while data loads.",
    category: "fix",
    details: [
      "Keep the Checks area in place",
      "Hide noisy loading text",
      "Show empty file text only after loading",
      "Shorten an older mobile update note"
    ]
  },
  {
    version: "0.7.1",
    title: "UI Cleanup",
    description: "Links, filters, and loading states are quieter.",
    category: "fix",
    details: [
      "Shorten GitHub issue links in comments",
      "Show saved pull filters faster",
      "Remove loud loading messages",
      "Simplify README, sign-in, and update text"
    ]
  },
  {
    version: "0.7.0",
    title: "Review Drafts",
    description: "Draft fixes and branch edits work more calmly.",
    category: "feature",
    details: [
      "Save Draft Fix work until deleted",
      "Keep PR branches and title/body in sync",
      "Use HTTP refresh when live updates cannot connect",
      "Keep Draft Fix transitions quiet"
    ]
  },
  {
    version: "0.6.2",
    title: "Icon Polish",
    description: "Action icons feel quieter and more consistent.",
    category: "fix",
    details: [
      "Use softer hover motion on panel and check actions",
      "Keep repo switching distinct from refresh",
      "Keep brand and status icons calm"
    ]
  },
  {
    version: "0.6.1",
    title: "Pull Stream Fixes",
    description: "Pull lists stay in place while switching and selecting.",
    category: "fix",
    details: [
      "Ignore stale pull stream responses",
      "Keep pull ordering stable after selection",
      "Keep live refresh from replacing the active pull"
    ]
  },
  {
    version: "0.6.0",
    title: "Code PR Workspace",
    description: "Code view can handle more branch and PR work.",
    category: "feature",
    details: [
      "Create and edit files on working branches",
      "Update PR title, body, labels, branches, and merge choice",
      "Resolve same-repo conflicts from Code view",
      "Read private PR details after sign-in",
      "Clean up header, sidebar, modals, and review spacing"
    ]
  },
  {
    version: "0.5.0",
    title: "Code Branches",
    description: "Branch, edit, and open PRs from Code view.",
    category: "feature",
    details: [
      "Create working branches and PRs",
      "Commit Code view file edits",
      "Syntax-highlight repository files",
      "Read from the active branch before commits"
    ]
  },
  {
    version: "0.4.0",
    title: "Live Code Workspace",
    description: "Live refresh and Code view for reviews.",
    category: "feature",
    details: [
      "Pull requests refresh in place while you review",
      "Repository files can be browsed from Code view",
      "Signed-in edits can be committed with a message",
      "Checks cover the new read and write paths"
    ]
  },
  {
    version: "0.3.5",
    title: "Sign-In Notice",
    description: "Clearer sign-in copy and product ownership.",
    category: "fix",
    details: [
      "Sign-in notice names Coccinella Labs more clearly",
      "Privacy and terms copy includes company context",
      "Account actions and legal links use a calmer layout",
      "Sign-in modal spacing and copy are quieter"
    ]
  },
  {
    version: "0.3.4",
    title: "Sign-In & Checks",
    description: "Small cleanup around sign-in, release notes, and checks.",
    category: "fix",
    details: [
      "First sign-in has a brief privacy and terms acknowledgement",
      "OAuth redirects leave a cleaner URL after sign-in",
      "Check logs find GitHub Actions jobs more consistently",
      "Check output is quieter by default"
    ]
  },
  {
    version: "0.3.3",
    title: "Branch History & Mobile Review",
    description: "Cleaner branch history and mobile review details.",
    category: "fix",
    details: [
      "Branch history renders compare commits",
      "Unrelated branch comparisons show a quiet empty state",
      "Mobile review file paths stay readable"
    ]
  },
  {
    version: "0.3.2",
    title: "Mobile Review",
    description: "Cleaner mobile review reading and jumps.",
    category: "fix",
    details: [
      "Review comments can jump back to the diff line",
      "Long review links wrap on mobile",
      "Review gutters stay aligned on mobile"
    ]
  },
  {
    version: "0.3.1",
    title: "State & UI Cleanup",
    description: "Cleaner saved state, timeline, and account tools.",
    category: "improvement",
    details: [
      "Saved pulls open directly without changing stream order",
      "Recent repo cleanup moved into the account menu",
      "Mobile history rows wrap long labels and branch names",
      "Graphite theme added",
      "Quieter tooltips and inline history actions"
    ]
  },
  {
    version: "0.3.0",
    title: "Sign-In & Saved State",
    description: "Added GitHub sign-in and saved app state.",
    category: "feature",
    details: [
      "GitHub sign-in with Supabase",
      "Saved theme and default repo",
      "Recent repos and saved pull requests",
      "PR discussion comments with user auth",
      "Inline review comments and review decisions",
      "Server checks for signed-in writes",
      "Signed-in app checks"
    ]
  },
  {
    version: "0.2.2",
    title: "Mobile History & Updates",
    description: "Cleaned up mobile tabs and updates.",
    category: "fix",
    details: [
      "Mobile tabs read cleanly on narrow screens",
      "History and checks alignment cleanup",
      "Local tags matched the release line"
    ]
  },
  {
    version: "0.2.1",
    title: "History, Checks & Navigation",
    description: "Improved timeline, checks, and diff jumps.",
    category: "fix",
    details: [
      "Timeline cleanup and duplicate event fixes",
      "Checks split out from review",
      "Single-line and range diff highlights",
      "Quieter checks and modal UI"
    ]
  },
  {
    version: "0.2.0",
    title: "Review Data & Checks",
    description: "Added more review data, checks, and timeline views.",
    category: "feature",
    details: [
      "Review API and timeline data",
      "Checks, notes, and CI run details",
      "Markdown and embedded HTML fixes"
    ]
  },
  {
    version: "0.1.2",
    title: "Theme Switch & UI",
    description: "Added theme controls and cleaned up the interface.",
    category: "improvement",
    details: [
      "Theme switching across the app",
      "Quieter presentation"
    ]
  },
  {
    version: "0.1.1",
    title: "Checks & Navigation",
    description: "Improved repo flow and GitHub checks.",
    category: "feature",
    details: [
      "GitHub checks",
      "Navigation improvements"
    ]
  },
  {
    version: "0.1.0",
    title: "Core Diff View",
    description: "First review view.",
    category: "feature",
    details: [
      "Pull request listing and filtering",
      "Branch comparison and review view",
      "Diff viewer",
      "Mobile layout"
    ]
  },
  {
    version: "Next",
    title: "Open Notes",
    description: "Notes for the next pass.",
    category: "planned",
    details: [
      "Watch daily review flow",
      "Keep release notes compact"
    ]
  },
];
