(() => {
"use strict";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const header = $("#site-header");
const mainContent = $("#main-content");
const heroSection = $("#top");
const pageProgress = $(".page-progress span");
const categoryLinks = $$(".category-strip a");
const shelves = $$(".shelf");
const menuTrigger = $("[data-menu-trigger]");
const mobileMenu = $("[data-mobile-menu]");
const searchDialog = $("[data-search-dialog]");
const searchInput = $("[data-search-input]");
const searchResults = $("[data-search-results]");
const searchStatus = $("[data-search-status]");
const searchEmpty = $("[data-search-empty]");
const detailDialog = $("[data-detail-dialog]");
const checkoutBackdrop = $("[data-modal-backdrop]");
const film = $("#hero-film");
const filmToggle = $("[data-film-toggle]");
const searchableCards = $$("[data-search]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const scrollBehavior = () => reducedMotion.matches ? "auto" : "smooth";
const menuBackground = [mainContent, $("body > footer"), $(".mobile-actions")].filter(Boolean);

$$('[data-current-year]').forEach((year) => {
  year.textContent = String(new Date().getFullYear());
});

const detailContent = {
  "goal-launch": {
    number: "01",
    category: "Start with your goal",
    title: "Start something new.",
    body: "A new offer needs more than a polished surface. Begin with the customer journey, the message and the smallest complete digital system that can launch with confidence.",
    points: ["Clarify the offer and the action it should create", "Shape website structure and visual direction together", "Choose only the supporting brand, search or workflow layers needed"],
    recommendation: { label: "Essential / focused launch", target: "#package-essential" },
  },
  "goal-upgrade": {
    number: "02",
    category: "Start with your goal",
    title: "Outgrow the old site.",
    body: "An upgrade starts by separating what is still useful from what now slows the business down. The answer may be a focused improvement or a more complete rebuild.",
    points: ["Audit the current story, journey and platform", "Keep valuable content and working foundations", "Prioritise the changes with the strongest practical effect"],
    recommendation: { label: "Upgrades & consulting", target: "#service-consulting" },
  },
  "goal-search": {
    number: "03",
    category: "Start with your goal",
    title: "Become easier to find.",
    body: "Search works best when meaning, structure and performance are part of the website plan from the beginning—not a checklist after launch.",
    points: ["Map the questions and intent behind useful searches", "Improve metadata, crawlability and internal pathways", "Create a content direction the business can sustain"],
    recommendation: { label: "SEO & search", target: "#service-search" },
  },
  "goal-grow": {
    number: "04",
    category: "Start with your goal",
    title: "Turn attention into enquiries.",
    body: "Growth becomes clearer when campaigns, landing experiences and the main site tell one connected story and point to one obvious next action.",
    points: ["Align campaign promise and landing-page message", "Reduce friction between interest and enquiry", "Connect useful measurement to the client journey"],
    recommendation: { label: "Digital marketing", target: "#service-marketing" },
  },
  "goal-automate": {
    number: "05",
    category: "Start with your goal",
    title: "Reduce repetitive work.",
    body: "Useful automation removes avoidable handoffs and duplicate data entry while keeping human review where context, tone or risk still matters.",
    points: ["Map the repeated steps before choosing tools", "Connect the systems already doing the real work", "Keep clear review and fallback points"],
    recommendation: { label: "Workflow & AI", target: "#service-automation" },
  },
  "goal-shape": {
    number: "06",
    category: "Start with your goal",
    title: "Clarify the real brief.",
    body: "When the request crosses web, search, workflow, marketing or brand, start by framing the outcome and dependencies instead of guessing at a list of deliverables.",
    points: ["Separate the symptom from the underlying need", "Turn competing priorities into a practical roadmap", "Define the smallest complete first move"],
    recommendation: { label: "Custom scope", target: "#package-custom" },
  },
  "service-websites": {
    number: "01",
    category: "Services",
    title: "Websites with presence and purpose.",
    body: "A custom website should make the business feel distinctive while making the next step simple. Architecture, expression and performance belong in the same blueprint.",
    points: ["Clear content hierarchy and calls to action", "Responsive visual direction that belongs to the brand", "Accessible interaction and lean delivery choices"],
  },
  "service-search": {
    number: "02",
    category: "Services",
    title: "Search foundations that belong in the build.",
    body: "SEO and search strategy are treated as part of the experience: how pages are understood, how information connects and how people reach useful answers.",
    points: ["Technical and on-page search foundations", "Metadata and internal linking direction", "Content pathways shaped around useful intent"],
  },
  "service-automation": {
    number: "03",
    category: "Services",
    title: "Workflow and AI with a practical job.",
    body: "Automation should earn its place by removing friction, improving a handoff or making a repeated process easier to operate.",
    points: ["Workflow mapping before tool selection", "Focused integrations between existing systems", "Human review where judgement still matters"],
  },
  "service-marketing": {
    number: "04",
    category: "Services",
    title: "Digital marketing that extends the brand.",
    body: "Campaign thinking, landing experiences and content systems should create momentum without fragmenting the way the business looks or sounds.",
    points: ["Campaign and landing-page direction", "Lead magnets and content pathways", "A measurement layer tied to useful actions"],
  },
  "service-branding": {
    number: "05",
    category: "Services",
    title: "A connected visual language.",
    body: "Branding work focuses on the practical system around the website—identity refinement, launch material and repeatable rules for future touchpoints.",
    points: ["Visual identity refinement", "Launch and social asset direction", "Reusable design rules for consistency"],
  },
  "service-consulting": {
    number: "06",
    category: "Services",
    title: "Upgrades and advice without a forced rebuild.",
    body: "When the foundation is sound, focused consulting can sharpen the story, search visibility, user journey or workflow without discarding everything.",
    points: ["Current-state reviews and focused audits", "Prioritised upgrade roadmaps", "Workshops for difficult digital decisions"],
  },
  "process-connect": {
    number: "01",
    category: "Connect to launch",
    title: "Connect.",
    body: "The work starts with context: what the business is trying to change, where the current friction lives and what has already been tried.",
    points: ["Share the commercial context", "Surface constraints and dependencies", "Identify the people and material the work depends on"],
  },
  "process-align": {
    number: "02",
    category: "Connect to launch",
    title: "Align.",
    body: "Before design expands, the project locks onto an outcome, a scope and a clear definition of what a complete first release means.",
    points: ["Agree the outcome and priority", "Confirm scope, inputs and review points", "Make the handover path visible early"],
  },
  "process-build": {
    number: "03",
    category: "Connect to launch",
    title: "Build.",
    body: "The experience is shaped in working, reviewable increments so important choices can be assessed in context instead of imagined from disconnected files.",
    points: ["Develop the structure and expression together", "Review useful milestones, not theatre", "Test responsive behaviour as the system grows"],
  },
  "process-launch": {
    number: "04",
    category: "Connect to launch",
    title: "Launch.",
    body: "The last stage is about confidence: verify the agreed essentials, publish deliberately and leave a practical route for what comes next.",
    points: ["Complete launch checks", "Confirm key journeys and access", "Put support or future upgrades on a clear footing"],
  },
  "process-handover": {
    number: "+",
    category: "Connect to launch",
    title: "Handover that reduces dependency.",
    body: "The close of the project maps the files, access and operating context agreed in the scope, including relevant ownership and licensing details.",
    points: ["Document the agreed access and operating context", "Clarify ownership and licensed material", "Leave a practical route for support or upgrades"],
  },
  "help-fit": {
    number: "01",
    category: "Help me decide",
    title: "Is Blvck Oak the right fit?",
    body: "The studio is designed for founders and teams whose work has outgrown a template and who want a sharper digital presence without coordinating five separate suppliers.",
    points: ["You value distinct visual direction", "You want the website and surrounding systems considered together", "You can make clear, accountable decisions"],
  },
  "help-ready": {
    number: "02",
    category: "Help me decide",
    title: "What helps a project move well?",
    body: "Speed is useful only when decisions stay clear. The strongest accelerators are an accountable decision-maker, useful source material and deliberate feedback.",
    points: ["One clear decision-maker", "Access to relevant brand and platform material", "Feedback grouped into agreed review rounds"],
  },
  "help-upgrade": {
    number: "03",
    category: "Help me decide",
    title: "Can an existing site be upgraded?",
    body: "Yes. When the underlying platform is workable, a focused upgrade can improve presentation, structure, search and conversion without discarding everything.",
    points: ["Begin with an honest platform and content review", "Keep the parts that still create value", "Rebuild only when the foundation limits the outcome"],
  },
  "help-services": {
    number: "04",
    category: "Help me decide",
    title: "Do I need every service?",
    body: "No. A good scope includes only the layers needed for the outcome. Services can stand alone or connect into one roadmap when the dependencies justify it.",
    points: ["Start from the outcome, not the service list", "Use a package when the need is already clear", "Use a custom scope when several layers depend on each other"],
  },
  "help-ai": {
    number: "05",
    category: "Help me decide",
    title: "Is AI required?",
    body: "No. AI and automation are tools, not compulsory features. They belong only where they remove friction or create a practical, measurable advantage.",
    points: ["Do not automate a process that is not understood", "Keep human review around context and risk", "Prefer a useful small workflow over a decorative feature"],
  },
  "help-start": {
    number: "06",
    category: "Help me decide",
    title: "Where should I begin?",
    body: "Use the estimate builder when the need is already defined. Book a conversation when you need help separating the visible symptom from the real brief.",
    points: ["Estimate for a clear package or starting point", "Book when scope or dependencies need discussion", "Bring the outcome you want, even if the solution is not decided"],
  },
};

function updatePageProgress() {
  const start = mainContent?.offsetTop || 0;
  const maximum = document.documentElement.scrollHeight - window.innerHeight - start;
  const ratio = maximum > 0 ? (window.scrollY - start) / maximum : 0;
  pageProgress.style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
  header.classList.toggle("is-scrolled", window.scrollY > 18);
}

window.addEventListener("scroll", updatePageProgress, { passive: true });
updatePageProgress();

function closeMenu({ restoreFocus = false } = {}) {
  if (!mobileMenu || !menuTrigger) return;
  const wasOpen = !mobileMenu.hidden;
  mobileMenu.hidden = true;
  document.body.classList.remove("menu-open");
  menuTrigger.setAttribute("aria-expanded", "false");
  menuTrigger.setAttribute("aria-label", "Open menu");
  menuBackground.forEach((element) => {
    element.inert = false;
    element.removeAttribute("aria-hidden");
  });
  if (restoreFocus && wasOpen) menuTrigger.focus();
}

function positionMobileMenu() {
  if (!mobileMenu || mobileMenu.hidden) return;
  const top = Math.max(0, header.getBoundingClientRect().bottom);
  mobileMenu.style.top = top + "px";
  mobileMenu.style.maxHeight = Math.max(0, window.innerHeight - top) + "px";
}

menuTrigger?.addEventListener("click", () => {
  const opening = mobileMenu.hidden;
  mobileMenu.hidden = !opening;
  document.body.classList.toggle("menu-open", opening);
  menuTrigger.setAttribute("aria-expanded", String(opening));
  menuTrigger.setAttribute("aria-label", opening ? "Close menu" : "Open menu");
  menuBackground.forEach((element) => {
    element.inert = opening;
    if (opening) element.setAttribute("aria-hidden", "true");
    else element.removeAttribute("aria-hidden");
  });
  positionMobileMenu();
  if (opening) requestAnimationFrame(() => $("a, button", mobileMenu)?.focus());
});

mobileMenu?.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = $$("a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex=\"-1\"])", mobileMenu)
    .filter((element) => element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

$$('a[href^="#"]', mobileMenu || document).forEach((link) => link.addEventListener("click", () => {
  const destination = $(link.hash);
  closeMenu();
  window.setTimeout(() => {
    const focusTarget = destination && ($("h2", destination) || destination);
    if (!focusTarget) return;
    focusTarget.setAttribute("tabindex", "-1");
    focusTarget.focus({ preventScroll: true });
  }, reducedMotion.matches ? 0 : 450);
}));

window.addEventListener("resize", () => {
  if (window.innerWidth > 860) closeMenu();
  positionMobileMenu();
});
window.addEventListener("scroll", positionMobileMenu, { passive: true });

function cardStep(track) {
  const card = $(".shelf-card", track);
  if (!card) return track.clientWidth;
  const styles = getComputedStyle(track);
  return card.getBoundingClientRect().width + (parseFloat(styles.columnGap) || parseFloat(styles.gap) || 0);
}

function setupShelf(shelf) {
  const track = $("[data-shelf-track]", shelf);
  const cards = $$(".shelf-card", track);
  const previous = $("[data-shelf-prev]", shelf);
  const next = $("[data-shelf-next]", shelf);
  const count = $("[data-shelf-count]", shelf);
  const progress = $("[data-shelf-progress]", shelf);
  let queued = false;

  const update = () => {
    queued = false;
    const maximum = Math.max(0, track.scrollWidth - track.clientWidth);
    const step = Math.max(1, cardStep(track));
    const current = Math.min(cards.length, Math.max(1, Math.round(track.scrollLeft / step) + 1));
    previous.disabled = track.scrollLeft <= 3;
    next.disabled = track.scrollLeft >= maximum - 3;
    count.textContent = String(current).padStart(2, "0") + " / " + String(cards.length).padStart(2, "0");
    const width = maximum === 0 ? 100 : Math.min(100, Math.max(8, (track.scrollLeft / maximum) * 92 + 8));
    progress.style.width = width + "%";
  };

  const queueUpdate = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  previous.addEventListener("click", () => track.scrollBy({ left: -cardStep(track), behavior: scrollBehavior() }));
  next.addEventListener("click", () => track.scrollBy({ left: cardStep(track), behavior: scrollBehavior() }));
  track.addEventListener("scroll", queueUpdate, { passive: true });
  track.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const focusedCard = event.target.closest?.(".shelf-card");
    if (focusedCard && track.contains(focusedCard)) {
      event.preventDefault();
      const currentIndex = cards.indexOf(focusedCard);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? cards.length - 1
          : Math.min(cards.length - 1, Math.max(0, currentIndex + (event.key === "ArrowRight" ? 1 : -1)));
      const nextCard = cards[nextIndex];
      nextCard.scrollIntoView({ behavior: scrollBehavior(), block: "nearest", inline: "center" });
      nextCard.focus({ preventScroll: true });
      return;
    }
    event.preventDefault();
    if (event.key === "Home") track.scrollTo({ left: 0, behavior: scrollBehavior() });
    if (event.key === "End") track.scrollTo({ left: track.scrollWidth, behavior: scrollBehavior() });
    if (event.key === "ArrowLeft") track.scrollBy({ left: -cardStep(track), behavior: scrollBehavior() });
    if (event.key === "ArrowRight") track.scrollBy({ left: cardStep(track), behavior: scrollBehavior() });
  });

  window.addEventListener("resize", queueUpdate);
  update();
}

shelves.forEach(setupShelf);

function setActiveCategory(section) {
  categoryLinks.forEach((link) => {
    const active = link.hash === "#" + section.id;
    link.classList.toggle("is-active", active);
    if (active) {
      link.setAttribute("aria-current", "location");
      link.scrollIntoView({ behavior: scrollBehavior(), block: "nearest", inline: "center" });
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

const categoryObserver = new IntersectionObserver(
  (entries) => {
    const active = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (active) setActiveCategory(active.target);
  },
  { threshold: [0.1, 0.25, 0.45], rootMargin: "-30% 0px -58% 0px" },
);

shelves.forEach((shelf) => categoryObserver.observe(shelf));

let detailOrigin = null;
let detailDestination = null;

function openDetail(card) {
  const detail = detailContent[card.dataset.detail];
  if (!detail || !detailDialog) return;
  detailOrigin = card;
  $("[data-detail-number]", detailDialog).textContent = detail.number;
  $("[data-detail-category]", detailDialog).textContent = detail.category;
  $("[data-detail-title]", detailDialog).textContent = detail.title;
  $("[data-detail-body]", detailDialog).textContent = detail.body;
  const points = $("[data-detail-points]", detailDialog);
  points.replaceChildren(...detail.points.map((point) => {
    const item = document.createElement("li");
    item.textContent = point;
    return item;
  }));
  const recommendation = $("[data-detail-recommendation]", detailDialog);
  if (detail.recommendation) {
    recommendation.hidden = false;
    recommendation.href = detail.recommendation.target;
    $("[data-detail-recommendation-label]", recommendation).textContent = detail.recommendation.label;
  } else {
    recommendation.hidden = true;
  }
  if (!detailDialog.open) detailDialog.showModal();
  history.replaceState(null, "", "#" + card.id);
}

$$("[data-detail]").forEach((card) => card.addEventListener("click", () => openDetail(card)));
$("[data-detail-close]")?.addEventListener("click", () => detailDialog.close());

$("[data-detail-recommendation]")?.addEventListener("click", (event) => {
  event.preventDefault();
  detailDestination = $(event.currentTarget.hash);
  detailDialog.close();
});

detailDialog?.addEventListener("click", (event) => {
  const rect = detailDialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) detailDialog.close();
});

detailDialog?.addEventListener("close", () => {
  if (detailDestination) {
    const destination = detailDestination;
    detailDestination = null;
    history.replaceState(null, "", "#" + destination.id);
    destination.scrollIntoView({ behavior: scrollBehavior(), block: "center", inline: "center" });
    window.setTimeout(() => destination.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 550);
    return;
  }
  const shelf = detailOrigin?.closest(".shelf");
  if (shelf) history.replaceState(null, "", "#" + shelf.id);
  detailOrigin?.focus();
});

const searchItems = searchableCards.map((card, index) => ({
  card,
  number: String(index + 1).padStart(2, "0"),
  title: $("h3", card)?.textContent.trim() || card.textContent.trim().slice(0, 80),
  category: card.closest(".shelf")?.dataset.sectionName || "Browse",
  haystack: ((card.dataset.search || "") + " " + card.textContent).toLowerCase(),
}));

function renderSearch(query = "") {
  const normalized = query.trim().toLowerCase();
  const matches = normalized ? searchItems.filter((item) => item.haystack.includes(normalized)) : searchItems;
  searchResults.replaceChildren();
  searchEmpty.hidden = matches.length > 0;
  searchStatus.textContent = normalized
    ? matches.length + " " + (matches.length === 1 ? "card" : "cards") + " matching “" + query.trim() + "”"
    : searchItems.length + " cards across the studio";

  matches.forEach((item) => {
    const result = document.createElement("button");
    result.className = "search-result";
    result.type = "button";
    result.dataset.publicAction = "";
    const number = document.createElement("span");
    number.textContent = item.number;
    const copy = document.createElement("span");
    const category = document.createElement("small");
    category.textContent = item.category;
    const title = document.createElement("strong");
    title.textContent = item.title;
    copy.append(category, title);
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    result.append(number, copy, arrow);
    result.addEventListener("click", () => {
      searchDialog.close();
      item.card.scrollIntoView({ behavior: scrollBehavior(), block: "center", inline: "center" });
      history.replaceState(null, "", "#" + item.card.id);
      window.setTimeout(() => item.card.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 550);
    });
    searchResults.append(result);
  });
}

function openSearch() {
  closeMenu();
  renderSearch(searchInput.value);
  if (!searchDialog.open) searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

$$("[data-search-open]").forEach((button) => button.addEventListener("click", openSearch));
$("[data-search-close]")?.addEventListener("click", () => searchDialog.close());
searchInput?.addEventListener("input", (event) => renderSearch(event.currentTarget.value));

searchDialog?.addEventListener("click", (event) => {
  const rect = searchDialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) searchDialog.close();
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  const checkoutOpen = checkoutBackdrop && !checkoutBackdrop.hidden;
  if (event.key === "/" && !isTyping && !searchDialog.open && !detailDialog.open && !checkoutOpen) {
    event.preventDefault();
    openSearch();
  }
  if (event.key === "Escape" && !mobileMenu?.hidden) closeMenu({ restoreFocus: true });
});

function syncFilmState() {
  if (!film || !filmToggle) return;
  const playing = !film.paused && !film.ended;
  $("[data-film-label]", filmToggle).textContent = playing ? "Pause film" : "Play film";
  filmToggle.setAttribute("aria-label", playing ? "Pause brand film" : "Play brand film");
  $("[data-film-icon]", filmToggle).setAttribute("d", playing ? "M8 6h3v12H8zm5 0h3v12h-3z" : "m9 6 9 6-9 6z");
}

async function startFilm() {
  if (!film) return;
  const reduced = reducedMotion.matches;
  const mobile = window.matchMedia("(max-width: 680px)").matches;
  const saveData = Boolean(navigator.connection?.saveData);
  if (reduced || mobile || saveData) {
    film.pause();
    syncFilmState();
    return;
  }
  try {
    await film.play();
  } catch {
    film.pause();
  }
  syncFilmState();
}

if (film && filmToggle) {
  let filmWasManuallyPaused = false;
  ["play", "pause", "ended", "error"].forEach((eventName) => film.addEventListener(eventName, syncFilmState));
  filmToggle.addEventListener("click", async () => {
    if (film.paused) {
      filmWasManuallyPaused = false;
      try {
        await film.play();
      } catch {
        film.pause();
      }
    } else {
      filmWasManuallyPaused = true;
      film.pause();
    }
    syncFilmState();
  });

  if (heroSection) {
    const filmObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !filmWasManuallyPaused) startFilm();
      else {
        film.pause();
        syncFilmState();
      }
    }, { threshold: 0.2 });
    filmObserver.observe(heroSection);
  } else {
    startFilm();
  }
}

const revealTargets = $$(".shelf__head, .shelf__track, .closing");
revealTargets.forEach((target) => target.classList.add("reveal"));

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.08, rootMargin: "0px 0px -5% 0px" },
);

revealTargets.forEach((target) => revealObserver.observe(target));

window.addEventListener("load", () => {
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (target) window.setTimeout(() => target.scrollIntoView({ behavior: scrollBehavior(), block: "center", inline: "center" }), 80);
});

})();
