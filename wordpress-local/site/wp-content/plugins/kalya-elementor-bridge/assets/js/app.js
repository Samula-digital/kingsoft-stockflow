(function () {
  document.documentElement.classList.add('js');

  const menuToggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');

  function closeMenu() {
    if (menu) menu.classList.remove('open');
  }

  function openWhatsApp(rawNumber, lines) {
    const digits = (rawNumber || '').replace(/\D+/g, '');
    if (!digits) return;
    const text = encodeURIComponent((lines || []).filter(Boolean).join('\n'));
    const url = 'https://wa.me/' + digits + '?text=' + text;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function trackEvent(name, params) {
    if (typeof window.gtag !== 'function') return;
    window.gtag(
      'event',
      name,
      Object.assign(
        {
          page_path: window.location.pathname,
          page_title: document.title,
          transport_type: 'beacon'
        },
        params || {}
      )
    );
  }

  function setFormResponse(form, type, html) {
    const response = form.querySelector('[data-form-response]');
    if (!response) return;
    response.className = 'form-response is-visible ' + (type === 'error' ? 'is-error' : 'is-success');
    response.innerHTML = html;
  }

  function setSubmitState(form, busy) {
    const submit = form.querySelector('button[type="submit"]');
    if (!submit) return;

    if (!submit.getAttribute('data-default-text')) {
      submit.setAttribute('data-default-text', submit.textContent || 'Submit');
    }

    submit.disabled = busy;
    submit.textContent = busy ? 'Sending...' : submit.getAttribute('data-default-text') || 'Submit';
  }

  function postLead(form, values) {
    const endpoint = form.getAttribute('data-endpoint') || 'lead-capture.php';
    const payload = new URLSearchParams();
    const merged = Object.assign(
      {
        lead_type: form.getAttribute('data-lead-form') || '',
        page_url: window.location.href,
        page_title: document.title
      },
      values || {}
    );

    Object.keys(merged).forEach(function (key) {
      payload.append(key, merged[key] || '');
    });

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: payload.toString()
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return { success: false, message: 'Invalid server response.' };
        })
        .then(function (data) {
          if (!response.ok || !data || data.success !== true) {
            throw new Error((data && data.message) || 'Lead capture failed');
          }
          return data;
        });
    });
  }

  function saveWhatsAppLines(form, lines) {
    form.setAttribute('data-whatsapp-lines', JSON.stringify(lines || []));
  }

  function readWhatsAppLines(form) {
    try {
      return JSON.parse(form.getAttribute('data-whatsapp-lines') || '[]');
    } catch (error) {
      return [];
    }
  }

  if (menuToggle && menu) {
    menuToggle.addEventListener('click', function () {
      menu.classList.toggle('open');
    });

    document.addEventListener('click', function (event) {
      if (!menu.classList.contains('open')) return;
      if (menu.contains(event.target) || menuToggle.contains(event.target)) return;
      closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1020) closeMenu();
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (event) {
      const id = anchor.getAttribute('href');
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeMenu();
    });
  });

  const contactForm = document.querySelector('[data-whatsapp-form]');
  if (contactForm) {
    contactForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const formData = new FormData(contactForm);
      const name = (formData.get('name') || '').toString().trim();
      const phone = (formData.get('phone') || '').toString().trim();
      const email = (formData.get('email') || '').toString().trim();
      const subject = (formData.get('subject') || '').toString().trim();
      const eventDate = (formData.get('event_date') || '').toString().trim();
      const attendees = (formData.get('attendees') || '').toString().trim();
      const message = (formData.get('message') || '').toString().trim();

      const whatsappLines = [
        'Hello Kalya Courts Hotel,',
        '',
        subject ? 'Subject: ' + subject : null,
        name ? 'Name: ' + name : null,
        phone ? 'Phone: ' + phone : null,
        email ? 'Email: ' + email : null,
        eventDate ? 'Preferred date: ' + eventDate : null,
        attendees ? 'Expected attendees: ' + attendees : null,
        '',
        message || '(No message provided)'
      ];

      setSubmitState(contactForm, true);
      saveWhatsAppLines(contactForm, whatsappLines);
      trackEvent('submit_event_enquiry', { form_name: 'event_enquiry' });

      postLead(contactForm, {
        name: name,
        phone: phone,
        email: email,
        subject: subject,
        event_date: eventDate,
        attendees: attendees,
        message: message
      })
        .then(function () {
          contactForm.reset();
          setFormResponse(
            contactForm,
            'success',
            'Enquiry sent to Kalya Courts. For faster coordination, <a href="#" data-open-whatsapp="event_enquiry">continue on WhatsApp</a>.'
          );
          trackEvent('lead_capture_success', { form_name: 'event_enquiry' });
        })
        .catch(function () {
          setFormResponse(
            contactForm,
            'error',
            'We could not send the enquiry right now. <a href="#" data-open-whatsapp="event_enquiry">Send it on WhatsApp instead</a>.'
          );
          trackEvent('lead_capture_error', { form_name: 'event_enquiry' });
        })
        .finally(function () {
          setSubmitState(contactForm, false);
        });
    });
  }

  const bookingForm = document.querySelector('[data-booking-form]');
  if (bookingForm) {
    bookingForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const formData = new FormData(bookingForm);
      const name = (formData.get('name') || '').toString().trim();
      const phone = (formData.get('phone') || '').toString().trim();
      const email = (formData.get('email') || '').toString().trim();
      const checkIn = (formData.get('check_in') || '').toString().trim();
      const checkOut = (formData.get('check_out') || '').toString().trim();
      const guests = (formData.get('guests') || '').toString().trim();
      const stayType = (formData.get('stay_type') || '').toString().trim();
      const notes = (formData.get('notes') || '').toString().trim();

      const whatsappLines = [
        'Hello Kalya Courts Hotel,',
        'I would like to check room availability.',
        '',
        name ? 'Name: ' + name : null,
        phone ? 'Phone: ' + phone : null,
        email ? 'Email: ' + email : null,
        checkIn ? 'Check-in: ' + checkIn : null,
        checkOut ? 'Check-out: ' + checkOut : null,
        guests ? 'Guests: ' + guests : null,
        stayType ? 'Purpose: ' + stayType : null,
        '',
        'Extra details:',
        notes || '(No extra details)'
      ];

      setSubmitState(bookingForm, true);
      saveWhatsAppLines(bookingForm, whatsappLines);
      trackEvent('submit_booking_request', { form_name: 'booking_request' });

      postLead(bookingForm, {
        name: name,
        phone: phone,
        email: email,
        check_in: checkIn,
        check_out: checkOut,
        guests: guests,
        stay_type: stayType,
        notes: notes
      })
        .then(function () {
          bookingForm.reset();
          setFormResponse(
            bookingForm,
            'success',
            'Booking request sent to Kalya Courts. If you want immediate help, <a href="#" data-open-whatsapp="booking_request">continue on WhatsApp</a>.'
          );
          trackEvent('lead_capture_success', { form_name: 'booking_request' });
        })
        .catch(function () {
          setFormResponse(
            bookingForm,
            'error',
            'We could not save the request right now. <a href="#" data-open-whatsapp="booking_request">Send it on WhatsApp instead</a>.'
          );
          trackEvent('lead_capture_error', { form_name: 'booking_request' });
        })
        .finally(function () {
          setSubmitState(bookingForm, false);
        });
    });
  }

  const revealItems = document.querySelectorAll('.reveal');
  if (revealItems.length) {
    revealItems.forEach(function (item) {
      const delay = item.getAttribute('data-reveal-delay');
      if (delay) item.style.setProperty('--reveal-delay', delay + 's');
    });

    const revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -40px 0px' }
    );

    revealItems.forEach(function (item) {
      revealObserver.observe(item);
    });
  }

  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const target = parseInt(el.getAttribute('data-count') || '0', 10);
          if (!target || target < 1) {
            counterObserver.unobserve(el);
            return;
          }

          const duration = 1000;
          const startTime = performance.now();

          function tick(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const value = Math.floor(progress * target);
            el.textContent = String(value);
            if (progress < 1) {
              window.requestAnimationFrame(tick);
            } else {
              el.textContent = String(target);
            }
          }

          window.requestAnimationFrame(tick);
          counterObserver.unobserve(el);
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach(function (counter) {
      counterObserver.observe(counter);
    });
  }

  function ensureExternalScript(id, src, onReady) {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') {
        if (typeof onReady === 'function') onReady();
      } else if (typeof onReady === 'function') {
        existing.addEventListener('load', onReady, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = function () {
      script.setAttribute('data-loaded', 'true');
      if (typeof onReady === 'function') onReady();
    };
    document.body.appendChild(script);
  }

  function renderInstagramLatest(container, postUrl, profileUrl) {
    container.innerHTML =
      '<blockquote class="instagram-media" data-instgrm-permalink="' + postUrl + '" data-instgrm-version="14">' +
      '<a href="' + postUrl + '" target="_blank" rel="noopener noreferrer">View latest Instagram post</a>' +
      '</blockquote>' +
      '<div class="social-open-links">' +
      '<a class="btn" href="' + postUrl + '" target="_blank" rel="noopener noreferrer">Open Post</a>' +
      '<a class="btn ghost" href="' + profileUrl + '" target="_blank" rel="noopener noreferrer">Profile</a>' +
      '</div>';

    ensureExternalScript('instagram-embed-script', 'https://www.instagram.com/embed.js', function () {
      if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
        window.instgrm.Embeds.process();
      }
    });
  }

  function extractTikTokVideoId(url) {
    const match = /\/video\/([0-9]{12,})/.exec(url || '');
    return match ? match[1] : '';
  }

  function renderTikTokLatest(container, postUrl, profileUrl) {
    const videoId = extractTikTokVideoId(postUrl);

    if (!videoId) {
      container.innerHTML =
        '<div class="social-fallback-note">Latest TikTok post is not available right now.</div>' +
        '<div class="social-open-links">' +
        '<a class="btn" href="' + profileUrl + '" target="_blank" rel="noopener noreferrer">Open TikTok Profile</a>' +
        '</div>';
      return;
    }

    container.innerHTML =
      '<blockquote class="tiktok-embed" cite="' + postUrl + '" data-video-id="' + videoId + '" style="max-width: 605px; min-width: 325px;">' +
      '<section><a target="_blank" rel="noopener noreferrer" href="' + postUrl + '">View latest TikTok post</a></section>' +
      '</blockquote>' +
      '<div class="social-open-links">' +
      '<a class="btn" href="' + postUrl + '" target="_blank" rel="noopener noreferrer">Open Post</a>' +
      '<a class="btn ghost" href="' + profileUrl + '" target="_blank" rel="noopener noreferrer">Profile</a>' +
      '</div>';

    ensureExternalScript('tiktok-embed-script', 'https://www.tiktok.com/embed.js', function () {
      if (typeof window.tiktokEmbedLoad === 'function') {
        window.tiktokEmbedLoad();
      }
    });
  }

  const socialScroller = document.querySelector('[data-social-scroller]');
  if (socialScroller) {
    const source = socialScroller.getAttribute('data-source') || 'social-feed.php';
    const status = document.querySelector('[data-social-updated]');
    const instagramCard = socialScroller.querySelector('[data-platform="instagram"]');
    const tiktokCard = socialScroller.querySelector('[data-platform="tiktok"]');

    if (instagramCard && tiktokCard) {
      const instagramContainer = instagramCard.querySelector('[data-social-embed="instagram"]');
      const tiktokContainer = tiktokCard.querySelector('[data-social-embed="tiktok"]');
      const instagramFallback = instagramCard.getAttribute('data-fallback-url') || 'https://www.instagram.com/kalyacourtshotel/';
      const instagramProfile = instagramCard.getAttribute('data-profile-url') || 'https://www.instagram.com/kalyacourtshotel/';
      const tiktokFallback = tiktokCard.getAttribute('data-fallback-url') || 'https://www.tiktok.com/@kalya.courts.hotel';
      const tiktokProfile = tiktokCard.getAttribute('data-profile-url') || 'https://www.tiktok.com/@kalya.courts.hotel';

      if (instagramContainer) {
        renderInstagramLatest(instagramContainer, instagramFallback, instagramProfile);
      }
      if (tiktokContainer) {
        renderTikTokLatest(tiktokContainer, tiktokFallback, tiktokProfile);
      }

      fetch(source, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('Social feed request failed');
          return response.json();
        })
        .then(function (data) {
          const instagramUrl = data && data.instagram && data.instagram.url ? data.instagram.url : instagramFallback;
          const tiktokUrl = data && data.tiktok && data.tiktok.url ? data.tiktok.url : tiktokFallback;

          if (instagramContainer) {
            renderInstagramLatest(instagramContainer, instagramUrl, instagramProfile);
          }
          if (tiktokContainer) {
            renderTikTokLatest(tiktokContainer, tiktokUrl, tiktokProfile);
          }

          if (status) {
            let message = 'Latest social posts synced';
            if (data && data.generated_at) {
              const synced = new Date(data.generated_at);
              if (!Number.isNaN(synced.getTime())) {
                message += ' ' + synced.toLocaleString();
              }
            }
            if (
              (data && data.instagram && data.instagram.fallback === true) ||
              (data && data.tiktok && data.tiktok.fallback === true)
            ) {
              message += ' (fallback used where needed)';
            }
            status.textContent = message;
          }
        })
        .catch(function () {
          if (status) {
            status.textContent = 'Live sync unavailable right now. Showing latest saved links.';
          }
        });
    }
  }

  document.addEventListener('click', function (event) {
    const actionLink = event.target.closest('[data-open-whatsapp]');
    if (actionLink) {
      event.preventDefault();
      const form = actionLink.closest('form');
      if (!form) return;
      openWhatsApp(form.getAttribute('data-whatsapp') || '', readWhatsAppLines(form));
      return;
    }

    const link = event.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    const text = (link.textContent || '').trim();

    if (href.indexOf('booking/book-rooms-kalyacourtsltd') !== -1) {
      trackEvent('select_booking_engine', { link_text: text });
    } else if (href.indexOf('wa.me') !== -1) {
      trackEvent('contact_whatsapp', { link_text: text });
    } else if (href.indexOf('tel:') === 0) {
      trackEvent('contact_call', { link_text: text });
    } else if (href.indexOf('mailto:') === 0) {
      trackEvent('contact_email', { link_text: text });
    } else if (href.indexOf('google.com/maps') !== -1) {
      trackEvent('view_map', { link_text: text });
    }
  });
})();
