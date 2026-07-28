(function () {
  var hiddenSidebarLabels = [
    "INSTAGRAM",
    "Instagram",
    "Instagram Config",
    "Link Instagram",
    "Insta DM Bot",
    "Insta Comment DM",
    "AI WHATSAPP CALLING",
    "Create Call Flow",
    "WA Call Logs",
    "Setup WA Calls",
    "WEBHOOK AUTOMATION",
    "Manage Webhooks",
    "Webhook Automation",
    "Webhook Logs",
    "TELEGRAM PLUGIN",
    "Telegram Plugin",
    "Telegram Sessions",
    "WA Embed Login",
    "Telegram Config",
  ];
  var normalizedHiddenLabels = hiddenSidebarLabels.map(function (label) {
    return label.toLowerCase();
  });

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

  function hideSidebarFeatures() {
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var text = node.nodeValue && node.nodeValue.trim();
          return text && normalizedHiddenLabels.indexOf(text.toLowerCase()) !== -1
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(function (textNode) {
      var label = textNode.nodeValue.trim();
      var menuItem = findMenuItem(textNode.parentElement, label);
      if (menuItem) {
        menuItem.setAttribute("data-hidden-sidebar-feature", label);
        menuItem.style.setProperty("display", "none", "important");
      }
    });
  }

  hideSidebarFeatures();

  var observer = new MutationObserver(hideSidebarFeatures);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
