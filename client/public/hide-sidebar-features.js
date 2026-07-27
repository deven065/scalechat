(function () {
  // PRO sidebar features are intentionally commented out for all roles.
  // To restore one later, remove or comment that label from this list.
  var hiddenSidebarLabels = [
    // Admin PRO addons
    "QR Plugin Settings",
    "Instagram Config",
    "Web Notificaion",
    "Web Notification",
    "Manual Web Push",
    "WA Embed Login",
    "Telegram Config",

    // User PRO addons
    "Link Instagram",
    "Insta DM Bot",
    "Insta Comment DM",
    "Add WhatsApp by QR",
    "WhatsApp Warmer",
    "Rest API",
    "REST API",
    "Create Call Flow",
    "WA Call Logs",
    "Setup WA Calls",
    "Manage Webhooks",
    "Webhook Automation",
    "Webhook Logs",
    "Telegram Sessions",
  ];

  // Empty section headers left behind after the PRO entries are hidden.
  var hiddenSidebarSectionLabels = [
    "PRO Addons",
    "Instagram",
    "WhatsApp QR Plugin",
    "WhatsApp QR code Plugin",
    "AI WhatsApp Calling",
    "Ai WhatsApp Calling",
    "Webhook Automation",
    "Telegram Plugin",
  ];

  var hiddenPages = [
    "qr-plugin-settings",
    "instagram-config",
    "web-notification",
    "send-web-push",
    "embed-config",
    "telegram-config",
    "link-instagram",
    "insta-autoreply",
    "insta-comment-autoreply",
    "wa-qr-connect",
    "wa-warmer",
    "wa-qr-rest-api",
    "create-call-flow",
    "wa-call-logs",
    "setup-wa-call",
    "manage-webhook",
    "webhook-automation",
    "webhook-logs",
    "telegram-sessions",
  ];

  var MOBILE_QUERY = window.matchMedia("(max-width: 768px)");
  var MOBILE_SIDEBAR_STORAGE_KEY = "scalechat_mobile_sidebar_expanded";

  function isMenuItemCandidate(element) {
    if (!element || element === document.body) return false;

    var className = String(element.className || "");
    var role = element.getAttribute && element.getAttribute("role");

    return (
      element.tagName === "A" ||
      element.tagName === "BUTTON" ||
      role === "button" ||
      role === "menuitem" ||
      className.indexOf("MuiListItemButton") !== -1 ||
      className.indexOf("MuiButtonBase") !== -1
    );
  }

  function getSidebarRoots() {
    var roots = Array.prototype.slice.call(
      document.querySelectorAll(".MuiDrawer-paper, nav"),
    );

    return roots;
  }

  function findMenuItem(element, label) {
    var current = element;

    while (current && current !== document.body) {
      if (isMenuItemCandidate(current)) return current;

      var parent = current.parentElement;
      if (!parent || !parent.textContent || parent.textContent.indexOf(label) === -1) {
        return current;
      }

      current = parent;
    }

    return element;
  }

  function findSectionLabel(element, label) {
    var current = element;

    while (current && current !== document.body) {
      var className = String(current.className || "");

      if (
        className.indexOf("MuiTypography") !== -1 ||
        current.tagName === "P" ||
        current.tagName === "SPAN"
      ) {
        return current;
      }

      var parent = current.parentElement;
      if (!parent || !parent.textContent || parent.textContent.indexOf(label) === -1) {
        return current;
      }

      current = parent;
    }

    return element;
  }

  function hideMatchingText(root, labels, finder, attributeName) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var text = node.nodeValue && node.nodeValue.trim();
        return labels.indexOf(text) !== -1
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(function (textNode) {
      var label = textNode.nodeValue.trim();
      var target = finder(textNode.parentElement, label);
      if (target) {
        target.setAttribute(attributeName, label);
        target.style.setProperty("display", "none", "important");
      }
    });
  }

  function hideProBadgedSidebarItems(root) {
    var chips = Array.prototype.slice.call(root.querySelectorAll(".MuiChip-root"));

    chips.forEach(function (chip) {
      if ((chip.textContent || "").trim().toUpperCase() !== "PRO") return;

      var menuItem = findMenuItem(chip, "PRO");
      if (menuItem) {
        menuItem.setAttribute("data-hidden-sidebar-feature", "PRO");
        menuItem.style.setProperty("display", "none", "important");
      }
    });
  }

  function hideSidebarFeatures() {
    getSidebarRoots().forEach(function (root) {
      hideMatchingText(root, hiddenSidebarLabels, findMenuItem, "data-hidden-sidebar-feature");
      hideMatchingText(
        root,
        hiddenSidebarSectionLabels,
        findSectionLabel,
        "data-hidden-sidebar-section",
      );
      hideProBadgedSidebarItems(root);
    });
  }

  function redirectHiddenPage() {
    var url = new URL(window.location.href);
    var currentPage = url.searchParams.get("page");

    if (hiddenPages.indexOf(currentPage) === -1) return;

    url.searchParams.set("page", "dashboard");
    window.history.replaceState({}, "", url.toString());
    window.dispatchEvent(
      typeof PopStateEvent === "function"
        ? new PopStateEvent("popstate")
        : new Event("popstate"),
    );
  }

  function getMobileSidebarExpanded() {
    return localStorage.getItem(MOBILE_SIDEBAR_STORAGE_KEY) !== "false";
  }

  function setMobileSidebarExpanded(expanded) {
    document.documentElement.setAttribute(
      "data-sc-mobile-sidebar-expanded",
      expanded ? "true" : "false",
    );
    localStorage.setItem(MOBILE_SIDEBAR_STORAGE_KEY, expanded ? "true" : "false");

    var button = document.querySelector(".sc-mobile-sidebar-toggle");
    if (button) {
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.setAttribute(
        "aria-label",
        expanded ? "Collapse mobile sidebar" : "Expand mobile sidebar",
      );
      button.textContent = expanded ? "<" : ">";
    }
  }

  function getVisibleMobileDrawerPaper() {
    var papers = Array.prototype.slice.call(document.querySelectorAll(".MuiDrawer-paper"));

    return papers.find(function (paper) {
      var rect = paper.getBoundingClientRect();
      var style = window.getComputedStyle(paper);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    });
  }

  function ensureMobileSidebarToggle() {
    var button = document.querySelector(".sc-mobile-sidebar-toggle");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "sc-mobile-sidebar-toggle";
      button.addEventListener("click", function () {
        setMobileSidebarExpanded(!getMobileSidebarExpanded());
      });
      document.body.appendChild(button);
    }

    setMobileSidebarExpanded(getMobileSidebarExpanded());
  }

  function syncMobileSidebarState() {
    ensureMobileSidebarToggle();

    if (!MOBILE_QUERY.matches) {
      document.body.classList.remove("sc-mobile-sidebar-open");
      return;
    }

    var paper = getVisibleMobileDrawerPaper();
    document.body.classList.toggle("sc-mobile-sidebar-open", Boolean(paper));

    if (paper) {
      var rect = paper.getBoundingClientRect();
      var anchor = rect.left > window.innerWidth / 2 ? "right" : "left";
      document.documentElement.setAttribute("data-sc-mobile-sidebar-anchor", anchor);
      paper.setAttribute("data-sc-mobile-sidebar", "true");
    }
  }

  redirectHiddenPage();
  setMobileSidebarExpanded(getMobileSidebarExpanded());
  ensureMobileSidebarToggle();
  hideSidebarFeatures();
  syncMobileSidebarState();

  var observer = new MutationObserver(function () {
    hideSidebarFeatures();
    syncMobileSidebarState();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("resize", syncMobileSidebarState);
  window.addEventListener("popstate", redirectHiddenPage);
})();
