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

  function findTextNodeByContent(text, root) {
    var walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var value = node.nodeValue && node.nodeValue.trim();
          return value && value.indexOf(text) !== -1
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    return walker.nextNode();
  }

  function closestByClass(element, className) {
    var current = element;

    while (current && current !== document.body) {
      if (String(current.className || "").indexOf(className) !== -1) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function setAttributeIfChanged(element, name, value) {
    if (element && element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }

  function setImportantStyle(element, name, value) {
    if (!element || !element.style) return;

    if (element.style.getPropertyValue(name) !== value) {
      element.style.setProperty(name, value, "important");
    }
  }

  function setImportantStyles(element, styles) {
    Object.keys(styles).forEach(function (name) {
      setImportantStyle(element, name, styles[name]);
    });
  }

  function clearBuilderMarkers(root) {
    if (!root) return;

    var marked = root.querySelectorAll(
      "[data-wa-form-builder-panel], [data-wa-form-builder-container], [data-wa-form-builder-content], [data-wa-form-builder-layout], [data-wa-form-builder-section], [data-wa-form-live-preview-phone]",
    );

    marked.forEach(function (node) {
      node.removeAttribute("data-wa-form-builder-panel");
      node.removeAttribute("data-wa-form-builder-container");
      node.removeAttribute("data-wa-form-builder-content");
      node.removeAttribute("data-wa-form-builder-layout");
      node.removeAttribute("data-wa-form-builder-section");
      node.removeAttribute("data-wa-form-live-preview-phone");
    });
  }

  function getModalPanel(modal, titleElement) {
    var papers = Array.prototype.slice.call(
      modal.querySelectorAll(".MuiDialog-paper, .MuiPaper-root"),
    );
    var paper = papers.find(function (candidate) {
      return candidate.contains(titleElement);
    });

    if (paper) return paper;

    var panel = titleElement;
    while (
      panel &&
      panel.parentElement &&
      panel.parentElement !== modal &&
      String(panel.parentElement.className || "").indexOf("MuiDialog-container") === -1
    ) {
      panel = panel.parentElement;
    }

    return panel || titleElement;
  }

  function getDisplay(element) {
    return (window.getComputedStyle(element).display || "").toLowerCase();
  }

  function isBuilderLayoutCandidate(element) {
    if (!element || !element.children || element.children.length < 2) return false;

    var display = getDisplay(element);
    if (display.indexOf("flex") === -1 && display.indexOf("grid") === -1) return false;

    var visibleChildren = Array.prototype.slice.call(element.children).filter(function (child) {
      var rect = child.getBoundingClientRect();
      return rect.width > 28 && rect.height > 28;
    });

    return visibleChildren.length >= 2;
  }

  function findSharedBuilderLayout(panel, nodes) {
    var current = nodes[0] && nodes[0].parentElement;
    var best = null;

    while (current && current !== panel) {
      var containsAll = nodes.every(function (node) {
        return node && current.contains(node);
      });

      if (containsAll && isBuilderLayoutCandidate(current)) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function getDirectChildContaining(parent, node) {
    var current = node && node.parentElement;

    while (current && current.parentElement && current.parentElement !== parent) {
      current = current.parentElement;
    }

    return current && current.parentElement === parent ? current : null;
  }

  function markLikelyBuilderContent(panel) {
    var children = Array.prototype.slice.call(panel.children || []);
    var content = children.find(function (child) {
      var text = child.textContent || "";
      return text.indexOf("COMPONENTS") !== -1 && text.indexOf("Live Preview") !== -1;
    });

    if (content) {
      setAttributeIfChanged(content, "data-wa-form-builder-content", "true");
    }
  }

  function classifyBuilderSection(child) {
    var text = child.textContent || "";
    var rect = child.getBoundingClientRect();

    if (!text.trim() || rect.width < 34) return "separator";
    if (text.indexOf("COMPONENTS") !== -1) return "components";
    if (text.indexOf("Live Preview") !== -1) return "preview";
    return "editor";
  }

  function markBuilderSections(panel) {
    var componentsNode = findTextNodeByContent("COMPONENTS", panel);
    var editorNode = findTextNodeByContent("Form Title", panel) || findTextNodeByContent("Click and add", panel);
    var previewNode = findTextNodeByContent("Live Preview", panel);

    if (!componentsNode || !previewNode) return;

    var layoutNodes = [componentsNode, previewNode];
    if (editorNode) layoutNodes.push(editorNode);

    var layout = findSharedBuilderLayout(panel, layoutNodes);
    if (!layout) return;

    setAttributeIfChanged(layout, "data-wa-form-builder-layout", "true");

    var content = layout;
    while (content.parentElement && content.parentElement !== panel) {
      content = content.parentElement;
    }
    setAttributeIfChanged(content, "data-wa-form-builder-content", "true");

    [
      { node: componentsNode, name: "components" },
      { node: editorNode, name: "editor" },
      { node: previewNode, name: "preview" },
    ].forEach(function (section) {
      var child = getDirectChildContaining(layout, section.node);
      if (child) {
        setAttributeIfChanged(child, "data-wa-form-builder-section", section.name);
      }
    });

    Array.prototype.slice.call(layout.children).forEach(function (child) {
      if (child.getAttribute("data-wa-form-builder-section")) return;

      setAttributeIfChanged(child, "data-wa-form-builder-section", classifyBuilderSection(child));
    });
  }

  function getPanelHeader(panel, titleElement) {
    return getDirectChildContaining(panel, titleElement) || (panel.children && panel.children[0]);
  }

  function markLivePreviewPhone(previewSection) {
    if (!previewSection) return;

    var existing = previewSection.querySelectorAll("[data-wa-form-live-preview-phone]");
    existing.forEach(function (node) {
      node.removeAttribute("data-wa-form-live-preview-phone");
    });

    var anchorNode =
      findTextNodeByContent("SCALECHAT Business", previewSection) ||
      findTextNodeByContent("9:41", previewSection) ||
      findTextNodeByContent("Preview Flow", previewSection);

    if (!anchorNode) return;

    var current = anchorNode.parentElement;
    var best = null;
    var fallback = null;

    while (current && current !== previewSection) {
      var rect = current.getBoundingClientRect();
      var text = current.textContent || "";
      var styles = window.getComputedStyle(current);
      var borderWidth = parseFloat(styles.borderTopWidth) || 0;
      var borderRadius = parseFloat(styles.borderTopLeftRadius) || 0;
      var isPhoneFrame =
        borderWidth >= 6 ||
        borderRadius >= 20 ||
        styles.overflow === "hidden";

      if (
        text.indexOf("9:41") !== -1 &&
        text.indexOf("SCALECHAT Business") !== -1 &&
        rect.width >= 180 &&
        rect.width <= 420 &&
        rect.height >= 180
      ) {
        if (!fallback || rect.width < fallback.getBoundingClientRect().width) {
          fallback = current;
        }

        if (isPhoneFrame && (!best || rect.width < best.getBoundingClientRect().width)) {
          best = current;
        }
      }

      current = current.parentElement;
    }

    best = best || fallback;
    if (!best) return;

    setAttributeIfChanged(best, "data-wa-form-live-preview-phone", "true");
    setImportantStyles(best, {
      width: "min(390px, calc(100vw - 36px))",
      "min-height": "min(760px, calc(100dvh - 190px))",
      display: "flex",
      "flex-direction": "column",
      "max-width": "100%",
      margin: "12px auto 30px",
      transform: "none",
      "transform-origin": "top center",
    });

    var body = best.children && best.children[3];
    setImportantStyles(body, {
      flex: "1 1 auto",
      "min-height": "0px",
      "max-height": "none",
      overflow: "auto",
    });
  }

  function getBuilderContent(panel) {
    var marked = panel.querySelector("[data-wa-form-builder-content]");
    if (marked) return marked;

    return Array.prototype.slice.call(panel.children || []).find(function (child) {
      var text = child.textContent || "";
      return text.indexOf("COMPONENTS") !== -1 && text.indexOf("Live Preview") !== -1;
    });
  }

  function applyMobileBuilderStyles(modal, panel, titleElement) {
    var container = modal.querySelector("[data-wa-form-builder-container]") ||
      modal.querySelector(".MuiDialog-container");
    var header = getPanelHeader(panel, titleElement);
    var content = getBuilderContent(panel);
    var layout = panel.querySelector("[data-wa-form-builder-layout]");
    var narrowViewport = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;

    if (!narrowViewport) return;

    if (!layout) {
      var componentsNode = findTextNodeByContent("COMPONENTS", panel);
      var previewNode = findTextNodeByContent("Live Preview", panel);
      layout = componentsNode && previewNode
        ? findSharedBuilderLayout(panel, [componentsNode, previewNode])
        : null;
      if (layout) {
        setAttributeIfChanged(layout, "data-wa-form-builder-layout", "true");
      }
    }

    setImportantStyles(modal, {
      position: "fixed",
      inset: "0px",
      width: "100vw",
      height: "100dvh",
      "max-width": "100vw",
      "max-height": "100dvh",
      overflow: "hidden",
      padding: "0px",
      margin: "0px",
    });

    setImportantStyles(container, {
      position: "fixed",
      inset: "0px",
      width: "100vw",
      height: "100dvh",
      "max-width": "100vw",
      "max-height": "100dvh",
      display: "flex",
      "align-items": "stretch",
      "justify-content": "flex-start",
      overflow: "hidden",
      padding: "0px",
      margin: "0px",
    });

    setImportantStyles(panel, {
      position: "fixed",
      inset: "0px",
      width: "100vw",
      height: "100dvh",
      "min-width": "0px",
      "max-width": "100vw",
      "min-height": "0px",
      "max-height": "100dvh",
      margin: "0px",
      transform: "none",
      "border-radius": "0px",
      display: "flex",
      "flex-direction": "column",
      overflow: "hidden",
      "box-sizing": "border-box",
    });

    setImportantStyles(header, {
      position: "relative",
      width: "100%",
      "max-width": "100%",
      "min-width": "0px",
      flex: "0 0 auto",
      padding: "14px 16px",
      margin: "0px",
      transform: "none",
      "box-sizing": "border-box",
    });

    setImportantStyles(content, {
      position: "relative",
      width: "100%",
      "max-width": "100%",
      "min-width": "0px",
      flex: "1 1 auto",
      display: "block",
      overflow: "auto",
      "overflow-x": "hidden",
      padding: "12px",
      margin: "0px",
      transform: "none",
      "box-sizing": "border-box",
      "-webkit-overflow-scrolling": "touch",
    });

    setImportantStyles(layout, {
      position: "relative",
      width: "100%",
      "max-width": "100%",
      "min-width": "0px",
      height: "auto",
      "max-height": "none",
      display: "flex",
      "flex-direction": "column",
      "flex-wrap": "nowrap",
      "align-items": "stretch",
      gap: "12px",
      overflow: "visible",
      padding: "0px",
      margin: "0px",
      transform: "none",
      "box-sizing": "border-box",
    });

    Array.prototype.slice.call((layout && layout.children) || []).forEach(function (child) {
      var section = child.getAttribute("data-wa-form-builder-section") || classifyBuilderSection(child);
      setAttributeIfChanged(child, "data-wa-form-builder-section", section);

      if (section === "separator") {
        setImportantStyle(child, "display", "none");
        return;
      }

      setImportantStyles(child, {
        position: "relative",
        left: "auto",
        right: "auto",
        top: "auto",
        bottom: "auto",
        width: "100%",
        "max-width": "100%",
        "min-width": "0px",
        flex: "0 0 auto",
        margin: "0px",
        padding: "0px",
        transform: "none",
        "box-sizing": "border-box",
        overflow: section === "components" ? "auto" : "visible",
        "overflow-x": "hidden",
      });

      if (section === "components") {
        setImportantStyles(child, {
          order: "1",
          "max-height": "300px",
          "padding-bottom": "8px",
        });
      } else if (section === "editor") {
        setImportantStyles(child, {
          order: "2",
          "min-height": "380px",
        });
      } else if (section === "preview") {
        setImportantStyles(child, {
          order: "3",
          "min-height": "430px",
        });
        markLivePreviewPhone(child);
      }
    });
  }

  function getMobileBuilderView(modal) {
    return modal.getAttribute("data-wa-form-mobile-view") || "fields";
  }

  function setMobileBuilderView(modal, view) {
    setAttributeIfChanged(modal, "data-wa-form-mobile-view", view);

    var buttons = modal.querySelectorAll("[data-wa-form-mobile-control]");
    buttons.forEach(function (button) {
      var selected = button.getAttribute("data-wa-form-mobile-control") === view;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function createMobileControlButton(modal, view, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("data-wa-form-mobile-control", view);
    button.setAttribute("aria-pressed", getMobileBuilderView(modal) === view ? "true" : "false");
    button.addEventListener("click", function () {
      setMobileBuilderView(modal, view);
    });
    return button;
  }

  function ensureMobileBuilderControls(modal, panel) {
    var narrowViewport = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    var existing = panel.querySelector("[data-wa-form-mobile-controls]");

    if (!narrowViewport) {
      if (existing) existing.remove();
      modal.removeAttribute("data-wa-form-mobile-view");
      return;
    }

    if (!modal.getAttribute("data-wa-form-mobile-view")) {
      setAttributeIfChanged(modal, "data-wa-form-mobile-view", "fields");
    }

    if (existing) {
      setMobileBuilderView(modal, getMobileBuilderView(modal));
      return;
    }

    var controls = document.createElement("div");
    controls.setAttribute("data-wa-form-mobile-controls", "true");
    controls.appendChild(createMobileControlButton(modal, "fields", "Fields"));
    controls.appendChild(createMobileControlButton(modal, "editor", "Form"));
    controls.appendChild(createMobileControlButton(modal, "preview", "Preview"));

    var content = getBuilderContent(panel);
    if (content && content.parentElement === panel) {
      panel.insertBefore(controls, content);
    } else {
      panel.appendChild(controls);
    }

    setMobileBuilderView(modal, getMobileBuilderView(modal));
  }

  function markDialogContainer(modal) {
    var container = Array.prototype.slice.call(modal.children || []).find(function (child) {
      return String(child.className || "").indexOf("MuiDialog-container") !== -1;
    });

    if (container) {
      setAttributeIfChanged(container, "data-wa-form-builder-container", "true");
    }
  }

  function removeInactiveBuilderState(activeModal) {
    var existing = document.querySelectorAll('[data-wa-form-builder="open"]');

    existing.forEach(function (node) {
      if (node !== activeModal) {
        node.removeAttribute("data-wa-form-builder");
        clearBuilderMarkers(node);
      }
    });
  }

  function markWhatsAppFormBuilder() {
    var titleNode = findTextNodeByContent("Add WhatsApp Form");

    if (!titleNode) {
      removeInactiveBuilderState(null);
      document.body.classList.remove("wa-form-builder-open");
      return;
    }

    var titleElement = titleNode.parentElement;
    var modal = closestByClass(titleElement, "MuiModal-root") || closestByClass(titleElement, "MuiDialog-root");
    if (!modal) return;

    removeInactiveBuilderState(modal);

    var panel = getModalPanel(modal, titleElement);
    var isNewlyMarked = modal.getAttribute("data-wa-form-builder") !== "open";
    if (isNewlyMarked) {
      clearBuilderMarkers(modal);
    }

    setAttributeIfChanged(modal, "data-wa-form-builder", "open");
    setAttributeIfChanged(panel, "data-wa-form-builder-panel", "true");
    markDialogContainer(modal);
    markLikelyBuilderContent(panel);
    markBuilderSections(panel);
    markLivePreviewPhone(panel.querySelector('[data-wa-form-builder-section="preview"]'));
    applyMobileBuilderStyles(modal, panel, titleElement);
    ensureMobileBuilderControls(modal, panel);
    document.body.classList.add("wa-form-builder-open");
  }

  var scheduled = false;
  function scheduleUiFixes() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      hideSidebarFeatures();
      markWhatsAppFormBuilder();
    });
  }

  hideSidebarFeatures();
  markWhatsAppFormBuilder();

  var observer = new MutationObserver(scheduleUiFixes);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("resize", scheduleUiFixes);
})();
