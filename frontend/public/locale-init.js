(function () {
  try {
    // Keep in sync with RTL_LOCALES in lib/i18n.ts.
    var rtlLocales = ["ar", "he", "fa", "ur"];

    var saved = localStorage.getItem("stellar-micropay:locale");
    var locale = saved === "es" || saved === "en" ? saved : "en";

    // Apply lang/dir before React hydrates so stored locales don't flash.
    document.documentElement.lang = locale;
    document.documentElement.dir = rtlLocales.indexOf(locale) !== -1 ? "rtl" : "ltr";
  } catch (e) {
    // Ignore storage failures and leave the build-time defaults in place.
  }
})();