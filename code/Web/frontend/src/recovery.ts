type Api = (path: string, body?: unknown) => Promise<any>;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function mountRecovery(host: HTMLElement, role: 'admin' | 'user' | null, api: Api, allowRequest: boolean) {
  document.querySelector('#recovery-dialog')?.remove();
  const anchor = role === 'admin' ? host.querySelector('.account') : allowRequest ? host.querySelector('#auth-form') : null;
  if (!anchor) return;
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'primary';
  open.textContent = role === 'admin' ? 'Xử lý yêu cầu đổi mật khẩu' : 'Gửi yêu cầu cho quản trị viên';
  anchor.append(open);
  open.onclick = () => {
    const dialog = document.createElement('dialog');
    dialog.id = 'recovery-dialog'; dialog.className = 'recovery-dialog';
    dialog.setAttribute('aria-labelledby', 'recovery-title');
    dialog.innerHTML = `<button type="button" class="back close-dialog">Đóng ×</button><h2 id="recovery-title">${role === 'admin' ? 'Yêu cầu đổi mật khẩu' : 'Yêu cầu hỗ trợ khôi phục'}</h2><p role="status" aria-live="polite" id="recovery-feedback"></p><section id="recovery-content"></section>`;
    document.body.append(dialog);
    dialog.querySelector('.close-dialog')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    const content = dialog.querySelector<HTMLElement>('#recovery-content')!;
    const message = dialog.querySelector<HTMLElement>('#recovery-feedback')!;
    const identity = `<label>Họ và tên<input name="name" required maxlength="200" autocomplete="name"></label><label>Email<input name="email" required type="email" maxlength="254" autocomplete="email"></label><label>Số điện thoại liên hệ<input name="phone" required type="tel" minlength="7" maxlength="25" autocomplete="tel"></label><label>Mã tài khoản<input name="accountId" required maxlength="36"></label>`;
    async function load() {
      const data = await api('/api/auth/recovery-requests');
      if (!dialog.isConnected) return;
      const labels: Record<string,string> = { pending: 'Chờ xử lý', approved: 'Đã đổi mật khẩu', rejected: 'Đã từ chối' };
      content.innerHTML = `<p>Xác minh danh tính qua thông tin liên hệ trước khi chấp nhận. Chỉ xử lý tài khoản người dùng. Danh sách tối đa 100 yêu cầu, ưu tiên yêu cầu chờ xử lý.</p><button type="button" id="reload-requests">Tải lại</button>${data.requests.length ? data.requests.map((row: any) => `<article class="recovery-card"><h3>${escape(row.account_name)} · ${escape(labels[row.status])}</h3><p>${escape(row.request_email)}<br>${escape(row.request_phone)}<br>Mã tài khoản: ${escape(row.request_account_id)}<br>Gửi: ${escape(new Date(row.created_at).toLocaleString('vi-VN'))}</p>${row.status === 'pending' ? `<form data-review="${escape(row.id)}"><label>Mật khẩu mới (khi chấp nhận)<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><label>Xác nhận mật khẩu<input name="confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><label>Ghi chú<textarea name="note" maxlength="1000"></textarea></label><div class="connection-actions"><button type="submit">Chấp nhận & đổi mật khẩu</button><button type="button" data-reject>Từ chối</button></div></form>` : `<p>${escape(row.review_note)}<br>${escape(row.reviewer_name || 'Quản trị viên không còn tồn tại')} · ${escape(new Date(row.reviewed_at).toLocaleString('vi-VN'))}</p>`}</article>`).join('') : '<p>Chưa có yêu cầu.</p>'}`;
      content.querySelector('#reload-requests')!.addEventListener('click', () => { void load().catch(error => { message.textContent = error.message; }); });
    }
    async function review(form: HTMLFormElement, decision: string) {
      const fields = new FormData(form);
      const buttons = form.querySelectorAll<HTMLButtonElement>('button');
      buttons.forEach(button => { button.disabled = true; });
      try {
        const result = await api(`/api/auth/recovery-requests/${form.dataset.review}/review`, { decision, password: fields.get('password'), confirm: fields.get('confirm'), note: fields.get('note') });
        message.textContent = result.message;
        await load();
      } catch (error) { message.textContent = (error as Error).message; }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    }
    if (role === 'admin') {
      content.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target as HTMLFormElement;
        const fields = new FormData(form);
        if (!fields.get('password') || fields.get('password') !== fields.get('confirm')) { message.textContent = 'Nhập mật khẩu mới và xác nhận khớp.'; return; }
        void review(form, 'approve');
      });
      content.addEventListener('click', event => {
        const reject = (event.target as HTMLElement).closest('[data-reject]');
        if (reject) void review(reject.closest('form')!, 'reject');
      });
      void load().catch(error => { message.textContent = error.message; });
    } else {
      content.innerHTML = `<p>Gửi thông tin cá nhân nếu bạn cần quản trị viên hỗ trợ thay đổi mật khẩu. Nếu vẫn truy cập được email, bạn có thể đóng cửa sổ và dùng OTP.</p><form>${identity}<button class="primary" type="submit">Gửi yêu cầu</button></form>`;
      for (const name of ['name','email','phone','accountId']) {
        const existing = host.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (existing) content.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = existing.value;
      }
      content.querySelector('form')!.onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const button = form.querySelector<HTMLButtonElement>('button')!;
        button.disabled = true;
        try {
          const result = await api('/api/auth/recovery-requests', Object.fromEntries(new FormData(form)));
          message.textContent = result.message; form.reset();
        } catch (error) { message.textContent = (error as Error).message; }
        finally { button.disabled = false; }
      };
    }
    dialog.showModal();
  };
}
