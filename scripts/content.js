// Design Library Unlocked - multi-site (Mobbin + Chamjo)
(() => {
	const TAG = "[Design Unlocked]";
	const HOST = location.hostname;
	const SITE = HOST.includes("chamjo") ? "chamjo" : HOST.includes("mobbin") ? "mobbin" : "generic";
	console.log(TAG, "loaded on", HOST, "→ site:", SITE);

	const stats = { scanned: 0, unlocked: 0, blurRemoved: 0, overlayRemoved: 0, paywallRemoved: 0 };
	const seenHosts = new Set();

	// --- Site-specific image upscaling rules ---------------------------------
	const SITE_RULES = {
		mobbin: {
			isCdn: (h) =>
				h.endsWith("mobbin.com") || h.includes("bytescale") || h.includes("upcdn.io"),
			isContent: (path) =>
				/(app_screens|web_screens|screens|flows|screenshots)/i.test(path),
			upscale: (url) => {
				const p = url.searchParams;
				p.set("f", "webp");
				p.set("w", "1920");
				p.set("q", "90");
				p.set("fit", "shrink-cover");
				return url.toString();
			},
		},
		chamjo: {
			isCdn: (h) =>
				h.endsWith("chamjo.design") ||
				h.includes("cloudinary") ||
				h.includes("imgix") ||
				h.includes("supabase") ||
				h.includes("cloudfront") ||
				h.includes("amazonaws") ||
				h.includes("vercel") ||
				h.includes("imagedelivery.net") ||
				h.includes("r2.dev"),
			isContent: () => true, // chamjo: try all images
			upscale: (url) => {
				const p = url.searchParams;
				// Strip common width-limiting params
				["w", "width", "h", "height", "q", "quality"].forEach((k) => {
					if (p.has(k)) {
						const v = parseInt(p.get(k), 10);
						if (k === "w" || k === "width") p.set(k, "1920");
						else if (k === "q" || k === "quality") p.set(k, "90");
						else if ((k === "h" || k === "height") && v < 1080) p.set(k, "1920");
					}
				});
				// Cloudinary-style path: /image/upload/w_400,q_60/...
				if (url.pathname.includes("/upload/")) {
					url.pathname = url.pathname.replace(
						/\/upload\/[^/]*\//,
						"/upload/w_1920,q_90,f_auto/",
					);
				}
				// Imgix-style
				if (url.hostname.includes("imgix")) {
					p.set("w", "1920");
					p.set("q", "90");
					p.set("auto", "format,compress");
				}
				return url.toString();
			},
		},
		generic: {
			isCdn: () => true,
			isContent: () => false,
			upscale: (url) => url.toString(),
		},
	};

	const rules = SITE_RULES[SITE];

	// --- 1. Image upscaling --------------------------------------------------
	const upscaleImage = (img) => {
		if (!img || img.dataset.dlUnlocked === "1") return;
		const rawSrc = img.currentSrc || img.src;
		if (!rawSrc || rawSrc.startsWith("data:")) return;

		let url;
		try {
			url = new URL(rawSrc, location.href);
		} catch {
			return;
		}

		if (!seenHosts.has(url.hostname)) {
			seenHosts.add(url.hostname);
			console.log(TAG, "img host:", url.hostname, url.pathname);
		}

		if (!rules.isCdn(url.hostname)) return;
		if (!rules.isContent(url.pathname)) return;

		stats.scanned++;
		const newSrc = rules.upscale(url);
		if (newSrc && newSrc !== rawSrc) {
			img.src = newSrc;
			img.removeAttribute("srcset");
			img.removeAttribute("loading");
			img.style.filter = "none";
			img.dataset.dlUnlocked = "1";
			stats.unlocked++;
		} else {
			img.dataset.dlUnlocked = "1";
		}

		// Walk parents: strip blur/overlay classes
		let p = img.parentElement;
		let depth = 0;
		while (p && depth < 6) {
			p.setAttribute("data-dl-cleaned", "1");
			if (typeof p.className === "string") {
				const cleaned = p.className
					.replace(/\bblur(-[\w-]+)?\b/g, "")
					.replace(/\bbackdrop-blur(-[\w-]+)?\b/g, "")
					.replace(/\b(after|before):bg-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):from-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):to-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):via-[\w/\[\].#-]+/g, "")
					.replace(/\b(after|before):bg-gradient[\w-]*/g, "")
					.replace(/\b(after|before):backdrop-[\w-]+/g, "")
					.replace(/\b(after|before):mix-blend-[\w-]+/g, "")
					.replace(/\b(after|before):opacity-[\w/\[\].]+/g, "");
				if (cleaned !== p.className) {
					p.className = cleaned;
					stats.blurRemoved++;
				}
			}
			if (p.style) {
				if (p.style.filter && p.style.filter.includes("blur")) p.style.filter = "none";
				if (p.style.backdropFilter) p.style.backdropFilter = "none";
			}
			p = p.parentElement;
			depth++;
		}

		// Remove sibling overlay divs (Mobbin-style: <div absolute inset-0 bg-... backdrop-blur>)
		const parent = img.parentElement;
		if (parent) {
			parent.querySelectorAll(":scope > div").forEach((sib) => {
				const cls = sib.className || "";
				if (typeof cls !== "string") return;
				const isOverlay =
					/\babsolute\b/.test(cls) &&
					/\binset-0\b/.test(cls) &&
					(/backdrop-blur/.test(cls) ||
						/\bbg-\[/.test(cls) ||
						/\bbg-(white|black|neutral)/.test(cls));
				if (isOverlay) {
					sib.remove();
					stats.overlayRemoved++;
				}
			});
		}
	};

	// --- 2. Strip computed blur ----------------------------------------------
	const stripBlurStyles = (root) => {
		if (!root.querySelectorAll) return;
		for (const el of root.querySelectorAll("*")) {
			const cs = getComputedStyle(el);
			if (cs.filter && cs.filter.includes("blur")) {
				el.style.setProperty("filter", "none", "important");
				stats.blurRemoved++;
			}
			if (cs.backdropFilter && cs.backdropFilter.includes("blur")) {
				el.style.setProperty("backdrop-filter", "none", "important");
			}
		}
	};

	// --- 3a. Chamjo-specific: inject mockup + remove locks ------------------
	const CHAMJO_SUPABASE = "https://ndbqcbbgigoygotysyae.supabase.co/storage/v1/object/public/app";

	const buildMockupUrl = (appName) =>
		`${CHAMJO_SUPABASE}/${encodeURIComponent(appName)}/mockup.webp`;

	const findAppName = (cardRoot) => {
		// Try common title patterns
		const candidates = cardRoot.querySelectorAll(
			'h1, h2, h3, h4, p[class*="font-semibold"], p[class*="font-bold"], div[class*="font-semibold"], div[class*="font-bold"], a[class*="text-xl"], span[class*="text-xl"]',
		);
		for (const c of candidates) {
			const txt = (c.textContent || "").trim();
			if (
				txt &&
				txt.length > 0 &&
				txt.length < 60 &&
				!/^(F&B|Shopping|Ride|Music|Health|Crypto|Photo|Spiritual|Digital|Groceries|Delivery|Wallet|Hailing|Streaming|App|News|Editor|Programs)/i.test(
					txt,
				)
			) {
				return txt;
			}
		}
		return null;
	};

	const injectChamjoMockup = (slot, appName) => {
		if (!appName || slot.querySelector("img[data-dl-injected]")) return;
		const img = document.createElement("img");
		img.src = buildMockupUrl(appName);
		img.alt = appName;
		img.dataset.dlInjected = "1";
		img.style.cssText =
			"position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;z-index:1;cursor:pointer;";
		img.onerror = () => {
			img.onerror = null;
			console.log(TAG, "mockup 404 for:", appName);
		};
		img.onclick = (e) => {
			e.stopPropagation();
			// Try to navigate to app detail page (format: /browse/AppName/id)
			// Since we can't find ID reliably, navigate to /browse/AppName and let server handle it
			const slug = appName.replace(/\s+/g, "%20");
			window.location.href = `/browse/${slug}`;
		};
		const cs = getComputedStyle(slot);
		if (cs.position === "static") slot.style.position = "relative";
		slot.appendChild(img);
		stats.unlocked++;
	};

	const removeChamjoLocks = () => {
		if (SITE !== "chamjo") return;

		const locks = document.querySelectorAll(
			'[data-name="icon-Lock"], [data-testid="chamjo-icon"][data-name*="Lock" i]',
		);

		for (const lockIcon of locks) {
			// Find lock overlay wrapper (the colored div with bottom-0/inset-0)
			let lockWrap = lockIcon;
			for (let i = 0; i < 3 && lockWrap.parentElement; i++) {
				const p = lockWrap.parentElement;
				const cls = p.className || "";
				if (
					typeof cls === "string" &&
					/\babsolute\b/.test(cls) &&
					/(bottom-0|inset-0|top-0)/.test(cls)
				) {
					lockWrap = p;
					break;
				}
				lockWrap = p;
			}

			// Phone slot = lockWrap's parent (the relative container)
			const slot = lockWrap.parentElement;

			// Walk up to find the card root, then extract app name
			let appName = null;
			let card = slot;
			for (let i = 0; i < 6 && card && !appName; i++) {
				appName = findAppName(card);
				if (!appName) card = card.parentElement;
			}

			// Remove the lock wrap
			lockWrap.remove();
			stats.overlayRemoved++;

			// Inject the mockup image + make card clickable
			if (slot && appName) {
				console.log(TAG, "injecting mockup for:", appName);
				injectChamjoMockup(slot, appName);
				// Also make the card itself clickable
				card.style.cursor = "pointer";
				card.onclick = () => {
					const slug = appName.replace(/\s+/g, "%20");
					window.location.href = `/browse/${slug}`;
				};
			}
		}

		// Solid color overlay divs (cleanup pass)
		document.querySelectorAll('div[class*="bg-[#"]').forEach((el) => {
			const cls = el.className || "";
			if (typeof cls !== "string") return;
			if (
				/\babsolute\b/.test(cls) &&
				(/bottom-0/.test(cls) || /inset-0/.test(cls)) &&
				/bg-\[#[0-9A-Fa-f]{6,8}\]/.test(cls)
			) {
				el.remove();
				stats.overlayRemoved++;
			}
		});
	};

	// --- 3b. Paywall removal -------------------------------------------------
	const PAYWALL_PHRASES = [
		"unlock all access",
		"subscribe to chamjo",
		"upgrade to pro",
		"reactivate pro",
		"unlock all",
		"go pro",
	];

	const isPaywallNode = (el) => {
		const txt = (el.textContent || "").toLowerCase().trim();
		if (!txt) return false;
		return PAYWALL_PHRASES.some((p) => txt.includes(p)) && txt.length < 600;
	};

	const removePaywallModal = () => {
		// Modal dialogs typically: role=dialog, [class*="modal"], or fixed inset-0 wrappers
		const candidates = document.querySelectorAll(
			'[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="Modal" i], [class*="dialog" i], div[class*="fixed"][class*="inset-0"]',
		);
		for (const el of candidates) {
			if (isPaywallNode(el)) {
				el.remove();
				stats.paywallRemoved++;
				console.log(TAG, "removed paywall modal");
			}
		}

		// Backdrop overlays (dark fixed inset-0 layer)
		document.querySelectorAll('div[class*="fixed"][class*="inset-0"]').forEach((el) => {
			const cls = el.className || "";
			if (typeof cls !== "string") return;
			if (/bg-(black|neutral|gray|slate)/.test(cls) || /bg-\[#[0-9A-Fa-f]+\]/.test(cls)) {
				// only remove if it's mostly empty (a backdrop, not content)
				if ((el.textContent || "").trim().length < 50) {
					el.remove();
					stats.paywallRemoved++;
				}
			}
		});

		// Re-enable body scroll if modal locked it
		if (document.body.style.overflow === "hidden") {
			document.body.style.overflow = "";
		}
		document.documentElement.style.overflow = "";
	};

	const hidePaywall = () => {
		removePaywallModal();
		document.querySelectorAll("aside").forEach((el) => {
			if (/upgrade|pro|trial|unlock|paywall|sign up|sign in/i.test(el.textContent || "")) {
				const rect = el.getBoundingClientRect();
				// only remove if it looks like a side panel, not the main nav
				if (rect.width < window.innerWidth * 0.5) {
					el.remove();
					stats.paywallRemoved++;
				}
			}
		});
		document
			.querySelectorAll(
				'[data-sentry-component*="Paywall" i], [data-sentry-component*="Upgrade" i], [class*="paywall" i], [class*="Paywall" i], [class*="upsell" i]',
			)
			.forEach((el) => {
				el.remove();
				stats.paywallRemoved++;
			});
	};

	// --- 4. Inject CSS safety net --------------------------------------------
	const injectCss = () => {
		if (document.getElementById("dl-unlocked-style")) return;
		const style = document.createElement("style");
		style.id = "dl-unlocked-style";
		style.textContent = `
			img { filter: none !important; -webkit-filter: none !important; opacity: 1 !important; }
			[class*="blur"] img, [class*="Blur"] img { filter: none !important; }

			[data-dl-cleaned="1"]::after,
			[data-dl-cleaned="1"]::before {
				background: none !important;
				background-image: none !important;
				background-color: transparent !important;
				box-shadow: none !important;
				mix-blend-mode: normal !important;
				opacity: 0 !important;
			}

			div.absolute.inset-0[class*="backdrop-blur"],
			div.absolute.inset-0[class*="bg-[hsl"],
			div.absolute.inset-0[class*="bg-[rgb"] {
				display: none !important;
			}

			[data-sentry-component*="Paywall" i],
			[data-sentry-component*="Upgrade" i],
			[class*="paywall" i],
			[class*="Paywall" i],
			[class*="upsell" i] { display: none !important; }
		`;
		(document.head || document.documentElement).appendChild(style);
	};

	// --- 5a. Event delegation: intercept ALL clicks on Chamjo cards ---------
	// Use capture phase so we run BEFORE React/Next.js handlers,
	// then stopImmediatePropagation to prevent paywall modal from firing.
	let cardDelegationInstalled = false;
	const installCardClickDelegation = () => {
		if (SITE !== "chamjo" || cardDelegationInstalled) return;
		cardDelegationInstalled = true;

		const handler = (e) => {
			// find nearest Chamjo card from click target
			const card = e.target.closest && e.target.closest(
				'div.relative.flex.flex-row[class*="rounded-2xl"]',
			);
			if (!card) return;
			// don't hijack our own badge button
			if (e.target.closest("#dl-unlocked-btn")) return;

			const appNameEl = card.querySelector(
				'span[class*="text-base-900"][class*="truncate"]',
			);
			const appName = appNameEl && appNameEl.textContent && appNameEl.textContent.trim();
			if (!appName) return;

			// Block React/Next click handler that would open paywall modal
			e.preventDefault();
			e.stopPropagation();
			if (e.stopImmediatePropagation) e.stopImmediatePropagation();

			const slug = appName.replace(/\s+/g, "%20");
			console.log(TAG, "card click intercepted, navigating to:", slug);
			window.location.href = `/browse/${slug}`;
		};

		// Capture phase = true so we fire BEFORE React listeners (which use bubble)
		document.addEventListener("click", handler, true);
		document.addEventListener("mousedown", handler, true);
		console.log(TAG, "card click delegation installed");
	};

	// --- 5b. Master scan ---------------------------------------------------
	const scan = (root) => {
		const target = root && root.querySelectorAll ? root : document.body;
		if (!target) return;
		target.querySelectorAll("img").forEach(upscaleImage);
		scanBackgroundImages(target);
		stripBlurStyles(target);
		removeChamjoLocks();
		installCardClickDelegation();
		hidePaywall();
	};

	// Scan elements that use background-image CSS instead of <img>
	const bgHosts = new Set();
	const scanBackgroundImages = (root) => {
		if (!root.querySelectorAll) return;
		for (const el of root.querySelectorAll("[style*='background-image'], [style*='background:']")) {
			const bg = el.style.backgroundImage || "";
			const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
			if (!m) continue;
			try {
				const u = new URL(m[1], location.href);
				if (!bgHosts.has(u.hostname)) {
					bgHosts.add(u.hostname);
					console.log(TAG, "bg-image host:", u.hostname, u.pathname);
				}
			} catch {}
		}
		// Also check computed styles for elements that look like image slots
		for (const el of root.querySelectorAll("div,figure,section,article")) {
			const cs = getComputedStyle(el);
			if (cs.backgroundImage && cs.backgroundImage !== "none" && !el.dataset.dlBgChecked) {
				el.dataset.dlBgChecked = "1";
				const m = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
				if (m) {
					try {
						const u = new URL(m[1], location.href);
						if (!bgHosts.has(u.hostname)) {
							bgHosts.add(u.hostname);
							console.log(TAG, "bg-image host (computed):", u.hostname, u.pathname);
						}
					} catch {}
				}
			}
		}
	};

	// --- 6. MutationObserver -------------------------------------------------
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type === "childList") {
				m.addedNodes.forEach((n) => {
					if (n.nodeType === 1) {
						if (n.tagName === "IMG") upscaleImage(n);
						else scan(n);
					}
				});
			} else if (m.type === "attributes" && m.target.tagName === "IMG") {
				m.target.dataset.dlUnlocked = "";
				upscaleImage(m.target);
			}
		}
	});

	// --- 7. UI badge ---------------------------------------------------------
	let button;
	const makeButton = () => {
		button = document.createElement("button");
		button.id = "dl-unlocked-btn";
		button.style.cssText = [
			"position:fixed",
			"left:20px",
			"bottom:20px",
			"z-index:2147483647",
			"display:flex",
			"align-items:center",
			"gap:8px",
			"padding:10px 14px",
			"border-radius:22px",
			"background:#111",
			"color:#fff",
			"border:1px solid #444",
			"font:13px system-ui,sans-serif",
			"cursor:pointer",
			"box-shadow:0 4px 14px rgba(0,0,0,.5)",
		].join(";");
		button.innerHTML = `🔓 <span id="dl-count">0</span> · ${SITE}`;
		button.title = "Design Library Unlocked — click to rescan";
		button.onclick = () => {
			scan(document.body);
			console.log(TAG, "stats", stats, "hosts:", [...seenHosts]);
			refreshBadge();
		};
		document.body.appendChild(button);
	};

	const refreshBadge = () => {
		const el = button && button.querySelector("#dl-count");
		if (el) el.textContent = stats.unlocked;
	};

	// --- 8. Boot -------------------------------------------------------------
	const boot = () => {
		injectCss();
		if (!document.body) {
			requestAnimationFrame(boot);
			return;
		}
		scan(document.body);
		console.log(
			TAG,
			"boot scan done. <img> count:",
			document.querySelectorAll("img").length,
			"| hosts seen:",
			[...seenHosts],
			"| bg hosts:",
			[...bgHosts],
		);
		makeButton();
		installCardClickDelegation();
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "srcset", "class", "style"],
		});
		setInterval(refreshBadge, 800);
		[500, 1500, 3000, 6000].forEach((t) => setTimeout(() => scan(document.body), t));
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
})();
