'use strict';

(() => {
  const view = document.getElementById('profile-content');
  if (!view) return;
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  let ownProfile = null;
  let browsing = null;
  let pending = false;
  let renderVersion = 0;
  const token = () => window._currentUser?.id;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  async function result(request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  }

  function message(error) {
    if (error.code === '23505') return 'این نام کاربری یا درخواست از قبل ثبت شده است.';
    if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code)) return 'به‌روزرسانی پایگاه داده برای پروفایل و دنبال‌کردن هنوز فعال نشده است.';
    if (error.code === '42501') return 'اجازهٔ انجام این کار وجود ندارد.';
    return error.message || 'انجام نشد. دوباره امتحان کن.';
  }

  function action(parent, label, handler) {
    const button = el('button', label, 'settings-save-btn');
    button.type = 'button';
    button.onclick = async () => {
      if (pending) return;
      pending = true;
      button.disabled = true;
      const status = view.querySelector('[role=status]');
      status.textContent = 'در حال انجام…';
      try {
        const done = await handler();
        const current = view.querySelector('[role=status]');
        if (current) current.textContent = typeof done === 'string' ? done : '';
      } catch (error) {
        const current = view.querySelector('[role=status]');
        if (current) current.textContent = message(error);
      } finally {
        pending = false;
        button.disabled = false;
      }
    };
    parent.append(button);
    return button;
  }

  function field(parent, label, type, value = '', max = 280) {
    const row = el('label', label);
    const input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    if (type === 'checkbox') input.checked = !!value;
    else if (type !== 'file') input.value = value;
    input.maxLength = max;
    input.className = 'settings-input';
    row.append(input);
    parent.append(row);
    return input;
  }

  function photo(src, name) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src || '')) return el('span', (name || '؟').slice(0, 1), 'asar-avatar');
    const img = el('img', '', 'asar-avatar');
    img.src = src;
    img.alt = 'آواتار';
    return img;
  }

  async function preparePhoto(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000) {
      throw new Error('یک تصویر JPEG، PNG یا WebP کوچک‌تر از ۸ مگابایت انتخاب کن.');
    }
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 224;
      const side = Math.min(image.width, image.height);
      canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 224, 224);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally { image.close(); }
  }

  const heading = () => el('div', 'پروفایل و کتابخانهٔ دوستان', 'settings-page-title');
  function card(title) {
    const section = el('section', '', 'settings-section asar-profile-card');
    section.append(el('h2', title));
    view.append(section);
    return section;
  }

  function showWorkList(parent, works) {
    if (!works.length) { parent.append(el('p', 'هنوز اثری برای نمایش انتخاب نشده است.')); return; }
    const list = el('ul', '', 'asar-profile-works');
    const names = { queue: 'در صف', active: 'در حال بررسی', done: 'تمام‌شده' };
    for (const work of works) {
      const row = el('li');
      row.append(el('strong', (work.pinned ? '★ ' : '') + work.title));
      row.append(el('small', [work.creator, work.collection, names[work.stage], work.rating ? work.rating + '/5' : ''].filter(Boolean).join(' · ')));
      list.append(row);
    }
    parent.append(list);
  }

  async function browse(peer, parent) {
    const client = window._sb;
    const profile = await result(client.from('asar_profiles').select('username,display_name,bio,avatar').eq('id', peer).maybeSingle());
    if (!profile) throw new Error('برای دیدن این پروفایل، ابتدا باید درخواستت تأیید شود.');
    const works = await result(client.from('asar_shared_works').select('title,creator,kind,stage,rating,pinned,collection').eq('owner', peer).order('pinned', { ascending: false }));
    const person = el('div', '', 'asar-person');
    person.append(photo(profile.avatar, profile.username), el('strong', profile.display_name || profile.username), el('span', '@' + profile.username));
    parent.replaceChildren(person);
    if (profile.bio) parent.append(el('p', profile.bio));
    showWorkList(parent, works);
    browsing = peer;
  }

  async function render() {
    const version = ++renderVersion;
    if (!view.closest('.section')?.classList.contains('active')) return;
    const uid = token();
    const current = () => token() === uid && version === renderVersion;
    const client = window._sb;
    view.replaceChildren(heading(), el('p', '', 'asar-profile-status'));
    view.lastElementChild.setAttribute('role', 'status');
    if (!uid || !client) {
      const signIn = card('ورود به حساب');
      signIn.append(el('p', 'برای استفاده از پروفایل و دیدن آثار مشترک وارد حساب شو.'));
      action(signIn, 'ورود یا ثبت‌نام', () => document.getElementById('auth-overlay').classList.add('show'));
      return;
    }

    const account = card('حساب');
    const email = field(account, 'ایمیل جدید', 'email', window._currentUser?.email || '');
    const currentPassword = field(account, 'رمز فعلی', 'password');
    const password = field(account, 'رمز جدید', 'password');
    currentPassword.autocomplete = 'current-password';
    password.autocomplete = 'new-password';
    async function verifyPassword() {
      if (!currentPassword.value) throw new Error('رمز فعلی حساب را وارد کن.');
      await result(client.auth.signInWithPassword({ email: window._currentUser.email, password: currentPassword.value }));
      currentPassword.value = '';
    }
    action(account, 'درخواست تغییر ایمیل', async () => {
      if (!email.checkValidity() || !email.value || email.value === window._currentUser.email) throw new Error('یک ایمیل جدید معتبر وارد کن.');
      await verifyPassword();
      await result(client.auth.updateUser({ email: email.value.trim() }));
      return 'درخواست ثبت شد. پیوند تأیید ایمیل را باز کن.';
    });
    action(account, 'تغییر رمز', async () => {
      if (password.value.length < 8) throw new Error('رمز جدید باید دست‌کم ۸ کاراکتر داشته باشد.');
      await verifyPassword();
      await result(client.auth.updateUser({ password: password.value }));
      password.value = '';
      return 'رمز تغییر کرد.';
    });

    try {
      ownProfile = await result(client.from('asar_profiles').select('*').eq('id', uid).maybeSingle());
      if (!current()) return;
      const profile = card('پروفایل من');
      const preview = el('div', '', 'asar-person');
      preview.append(photo(ownProfile?.avatar, ownProfile?.username));
      profile.append(preview);
      const username = field(profile, 'نام کاربری', 'text', ownProfile?.username || '', 24);
      username.pattern = '[a-z0-9_]{3,24}';
      username.dir = 'ltr';
      const name = field(profile, 'نام نمایشی', 'text', ownProfile?.display_name || '', 60);
      const bio = field(profile, 'معرفی کوتاه', 'textarea', ownProfile?.bio || '');
      const avatar = field(profile, 'عکس یا آواتار', 'file', '');
      avatar.accept = 'image/png,image/jpeg,image/webp';
      const discover = field(profile, 'پروفایلم با وارد کردن نام کاربری دقیق پیدا شود', 'checkbox', ownProfile?.discoverable);
      let avatarData = ownProfile?.avatar || '';
      action(profile, 'برداشتن تصویر', () => { avatarData = ''; avatar.value = ''; preview.replaceChildren(photo('', username.value)); });
      action(profile, 'ذخیرهٔ پروفایل', async () => {
        username.value = username.value.trim().toLowerCase();
        if (!username.value || !username.checkValidity()) throw new Error('نام کاربری را با ۳ تا ۲۴ حرف انگلیسی، رقم یا زیرخط بنویس.');
        if (avatar.files?.[0]) avatarData = await preparePhoto(avatar.files[0]);
        ownProfile = await result(client.from('asar_profiles').upsert({
          id: uid, username: username.value, display_name: name.value.trim(), bio: bio.value.trim(),
          avatar: avatarData, discoverable: discover.checked
        }).select('*').single());
        updateAvatar();
        await render();
        return 'پروفایل ذخیره شد.';
      });
      if (!ownProfile) return;

      const sharing = card('آثاری که دنبال‌کننده‌ها می‌بینند');
      const shared = await result(client.from('asar_shared_works').select('*').eq('owner', uid));
      if (!current()) return;
      const byId = new Map(shared.map(work => [work.work_id, work]));
      const library = window.asarCollectionSource?.items() || [];
      const options = el('div', '', 'asar-share-list');
      sharing.append(options);
      const selected = [];
      for (const item of library) {
        if (!item.id || !item.title || !['book', 'film', 'music'].includes(item.type)) continue;
        const previous = byId.get(String(item.id));
        const row = el('div', '', 'asar-share-row');
        const share = field(row, item.title, 'checkbox', !!previous);
        const pinned = field(row, 'سنجاق', 'checkbox', previous?.pinned);
        const collection = field(row, 'نام مجموعه برای نمایش', 'text', previous?.collection || '', 70);
        selected.push({ item, share, pinned, collection });
        options.append(row);
      }
      action(sharing, 'ذخیرهٔ آثار مشترک', async () => {
        const records = selected.filter(entry => entry.share.checked).map(({ item, pinned, collection }) => ({
          owner: uid, work_id: String(item.id).slice(0, 120), title: String(item.title).slice(0, 300),
          creator: String(item.creator || '').slice(0, 160), kind: item.type,
          stage: ['queue', 'active', 'done'].includes(item.stage) ? item.stage : 'queue',
          rating: Math.min(5, Math.max(0, Math.round(Number(item.rating) || 0))),
          pinned: pinned.checked, collection: collection.value.trim()
        }));
        const newIds = new Set(records.map(row => row.work_id));
        const removed = shared.filter(row => !newIds.has(row.work_id)).map(row => row.work_id);
        if (removed.length) await result(client.from('asar_shared_works').delete().eq('owner', uid).in('work_id', removed));
        if (records.length) await result(client.from('asar_shared_works').upsert(records));
        await render();
        return 'آثار مشترک ذخیره شدند.';
      });

      const people = card('دنبال‌کردن');
      const handle = field(people, 'نام کاربری دقیق', 'text', '', 24);
      handle.dir = 'ltr';
      const searchResult = el('div', '', 'asar-follow-list');
      const peerView = el('div', '', 'asar-peer-view');
      action(people, 'پیدا کردن حساب', async () => {
        const [match] = await result(client.rpc('asar_find_profile', { handle: handle.value.trim() }));
        searchResult.replaceChildren();
        if (!match) return 'حساب قابل نمایشی با این نام پیدا نشد.';
        searchResult.append(el('strong', '@' + match.username));
        const existing = await result(client.from('asar_follows').select('status').eq('requester', uid).eq('owner', match.id).maybeSingle());
        if (existing?.status === 'accepted') action(searchResult, 'دیدن پروفایل و آثار', () => browse(match.id, peerView));
        else if (existing) searchResult.append(el('span', 'در انتظار تأیید'));
        else action(searchResult, 'درخواست دنبال‌کردن', async () => {
          await result(client.from('asar_follows').insert({ requester: uid, owner: match.id }));
          await render();
          return 'درخواست فرستاده شد.';
        });
        action(searchResult, 'مسدود کردن', async () => {
          await result(client.rpc('asar_block_profile', { other_id: match.id }));
          browsing = null;
          await render();
          return 'حساب مسدود شد.';
        });
      });
      people.append(searchResult);
      const [relations, names, blocks] = await Promise.all([
        result(client.from('asar_follows').select('requester,owner,status').or('requester.eq.' + uid + ',owner.eq.' + uid)),
        result(client.rpc('asar_follow_handles')),
        result(client.from('asar_blocks').select('blocked').eq('owner', uid))
      ]);
      if (!current()) return;
      const handles = new Map(names.map(entry => [entry.peer_id, entry.username]));
      for (const relation of relations) {
        const incoming = relation.owner === uid;
        const peer = incoming ? relation.requester : relation.owner;
        if (!handles.has(peer)) continue;
        const row = el('div', '', 'asar-follow-list');
        row.append(el('strong', '@' + handles.get(peer)), el('span', incoming ? (relation.status === 'accepted' ? 'دنبال‌کننده' : 'درخواست ورودی') : (relation.status === 'accepted' ? 'دنبال می‌کنی' : 'در انتظار تأیید')));
        const query = () => client.from('asar_follows');
        if (incoming && relation.status === 'pending') action(row, 'تأیید', async () => {
          await result(query().update({ status: 'accepted' }).eq('requester', peer).eq('owner', uid));
          await render();
        });
        if (!incoming && relation.status === 'accepted') action(row, 'دیدن آثار', () => browse(peer, peerView));
        action(row, incoming && relation.status === 'pending' ? 'رد' : 'حذف', async () => {
          await result(query().delete().eq('requester', relation.requester).eq('owner', relation.owner));
          if (browsing === peer) browsing = null;
          await render();
        });
        action(row, 'مسدود کردن', async () => {
          await result(client.rpc('asar_block_profile', { other_id: peer }));
          browsing = null;
          await render();
        });
        people.append(row);
      }
      for (const { blocked } of blocks) {
        const row = el('div', '', 'asar-follow-list');
        row.append(el('span', '@' + (handles.get(blocked) || 'حساب مسدودشده')));
        action(row, 'رفع مسدودیت', async () => {
          await result(client.from('asar_blocks').delete().eq('owner', uid).eq('blocked', blocked));
          await render();
        });
        people.append(row);
      }
      people.append(peerView);
      if (browsing) await browse(browsing, peerView).catch(() => { browsing = null; });
    } catch (error) {
      if (current()) view.querySelector('[role=status]').textContent = message(error);
    }
  }

  function updateAvatar() {
    if (!sidebarAvatar || !ownProfile || !token() || ownProfile.id !== token()) return;
    sidebarAvatar.replaceChildren(photo(ownProfile.avatar, ownProfile.username));
    document.getElementById('sidebar-user-name').textContent = ownProfile.display_name || '@' + ownProfile.username;
  }

  window.asarProfile = {
    render,
    async accountChanged() {
      const uid = token();
      ownProfile = null;
      browsing = null;
      if (uid) {
        try {
          const profile = await result(window._sb.from('asar_profiles').select('id,username,display_name,avatar').eq('id', uid).maybeSingle());
          if (uid === token()) { ownProfile = profile; updateAvatar(); }
        } catch {}
      }
      if (!pending) render();
    }
  };
  window.asarProfile.accountChanged();
})();
