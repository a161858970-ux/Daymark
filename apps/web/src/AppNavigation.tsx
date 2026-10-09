import { GlobalSearchButton } from "./SearchSurface.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";
import { useT } from "./i18n/index.js";

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

export function AppNavigation({
  page,
  onNavigate,
  onSearch,
}: {
  page: PrimaryPage;
  onNavigate(page: PrimaryPage): void;
  onSearch(): void;
}) {
  const t = useT();
  const destinations: {
    page: PrimaryPage;
    label: string;
    shortLabel: string;
  }[] = [
    {
      page: "overview",
      label: t("nav.overview"),
      shortLabel: t("nav.overviewShort"),
    },
    {
      page: "courses",
      label: t("nav.courses"),
      shortLabel: t("nav.coursesShort"),
    },
    {
      page: "calendar",
      label: t("nav.calendar"),
      shortLabel: t("nav.calendarShort"),
    },
  ];

  return (
    <nav className="main-nav" aria-label={t("nav.primary")}>
      <div className="brand" aria-label={t("common.brandName")}>
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
        </span>
        <span>
          <strong>{t("common.brandName")}</strong>
          <small>{t("common.brandLatin")}</small>
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
          label={t("nav.search")}
        />
        <LanguageSwitcher variant="nav" />
      </div>
      <p className="nav-note">{t("nav.note")}</p>
    </nav>
  );
}
