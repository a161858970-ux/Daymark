import { GlobalSearchButton } from "./SearchSurface.js";

export type PrimaryPage = "overview" | "courses" | "calendar";

function NavigationIcon({ page }: { page: PrimaryPage }) {
  if (page === "overview")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 7.5h11M6.5 12h11M6.5 16.5h7" />
        <circle cx="4" cy="7.5" r=".75" />
        <circle cx="4" cy="12" r=".75" />
        <circle cx="4" cy="16.5" r=".75" />
      </svg>
    );
  if (page === "courses")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 6.5c2.8-.9 5.3-.6 7.5.9v11c-2.2-1.5-4.7-1.8-7.5-.9zM19.5 6.5c-2.8-.9-5.3-.6-7.5.9v11c2.2-1.5 4.7-1.8 7.5-.9z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M8 3.8v3.4M16 3.8v3.4M4 9.5h16M8 13h2M14 13h2M8 16.5h2" />
    </svg>
  );
}

const destinations: { page: PrimaryPage; label: string; shortLabel: string }[] =
  [
    { page: "overview", label: "事项总览", shortLabel: "事项" },
    { page: "courses", label: "课程", shortLabel: "课程" },
    { page: "calendar", label: "日程", shortLabel: "日程" },
  ];

export function AppNavigation({
  page,
  onNavigate,
  onSearch,
}: {
  page: PrimaryPage;
  onNavigate(page: PrimaryPage): void;
  onSearch(): void;
}) {
  return (
    <nav className="main-nav" aria-label="主导航">
      <div className="brand" aria-label="课程与事项">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
        </span>
        <span>
          <strong>课程与事项</strong>
          <small>COURSE MANAGER</small>
        </span>
      </div>
      <div className="nav-primary">
        {destinations.map((destination) => (
          <button
            key={destination.page}
            type="button"
            className={page === destination.page ? "active" : ""}
            aria-current={page === destination.page ? "page" : undefined}
            onClick={() => onNavigate(destination.page)}
          >
            <span className="nav-glyph">
              <NavigationIcon page={destination.page} />
            </span>
            <span className="nav-label nav-label-long">
              {destination.label}
            </span>
            <span className="nav-label nav-label-short">
              {destination.shortLabel}
            </span>
          </button>
        ))}
      </div>
      <div className="nav-utility">
        <GlobalSearchButton
          onOpen={onSearch}
          className="nav-search-trigger"
          label="搜索记录"
        />
      </div>
      <p className="nav-note">记录课程里的事项、信息与上下文。</p>
    </nav>
  );
}
