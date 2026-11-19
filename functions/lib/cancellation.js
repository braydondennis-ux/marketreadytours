"use strict";
const {escapeHtml, stableHash} = require('./domain');
const {sponsorsWithFunds} = require('./sponsor-safety');
const CLOVER_LOOKUP = 'https://www.clover.com/orders';
function refundTasks(tour, payments = {}, invoices = {}) {
  const tasks = {};
  const covered = new Set();
  for (const [id, payment] of Object.entries(payments).sort(([a],[b])=>a.localeCompare(b))) {
    if (payment.tourId !== tour.id || payment.status !== 'paid') continue;
    const sponsor = (tour.sponsors || []).find(s=>s.id === payment.sponsorId) || {};
    covered.add(payment.sponsorId);
    tasks['payment_' + id] = {
      id: 'payment_' + id, sponsorId: payment.sponsorId || '', sponsorName: sponsor.name || 'Sponsor',
      email: sponsor.email || '', phone: sponsor.phone || '', provider: payment.provider || 'clover',
      amountCents: Number.isFinite(payment.amountCents) ? payment.amountCents : null,
      amountLabel: 'Recorded sponsorship amount; verify the final charged total and any surcharge in Clover.',
      paymentId: payment.cloverPaymentId || '', checkoutSessionId: payment.checkoutSessionId || id,
      paidAt: payment.paidAt || null, paymentUrl: CLOVER_LOOKUP, status: 'pending',
    };
  }
  for (const [id, invoice] of Object.entries(invoices).sort(([a],[b])=>a.localeCompare(b))) {
    if (invoice.tourId !== tour.id || !['paid','partially_paid'].includes(invoice.status)) continue;
    const sponsor = (tour.sponsors || []).find(s=>s.signupId === invoice.signupId) || {};
    if (sponsor.id) covered.add(sponsor.id);
    tasks['invoice_' + id] = {
      id:'invoice_' + id, sponsorId:sponsor.id || '', sponsorName:sponsor.name || 'Sponsor',
      email:sponsor.email || '', phone:sponsor.phone || '', provider:'square',
      amountCents:invoice.status === 'paid' && Number.isFinite(invoice.amountCents) ? invoice.amountCents : null,
      amountLabel:'Verify the amount actually collected and any prior refund in Square.',
      paymentId:id, checkoutSessionId:'', paidAt:invoice.updatedAt || null,
      paymentUrl:'https://squareup.com/dashboard/invoices', status:'pending',
    };
  }
  for (const sponsor of sponsorsWithFunds(tour.sponsors)) {
    if (covered.has(sponsor.id)) continue;
    tasks['sponsor_' + sponsor.id] = {
      id: 'sponsor_' + sponsor.id, sponsorId: sponsor.id, sponsorName: sponsor.name || 'Sponsor',
      email: sponsor.email || '', phone: sponsor.phone || '', provider: sponsor.paymentMethod || 'manual',
      amountCents: null, amountLabel: 'Amount not recorded. Check the original payment before refunding.',
      paymentId: sponsor.paymentRef || '', checkoutSessionId: '', paidAt: sponsor.paidAt || null,
      paymentUrl: sponsor.paymentMethod === 'clover' ? CLOVER_LOOKUP : '', status: 'pending',
    };
  }
  return tasks;
}
function cancellationPreview(tour, payments, invoices) {
  const tasks = tour.cancellation?.refundTasks || refundTasks(tour, payments, invoices);
  return {tourId: tour.id, name: tour.name, date: tour.date, version: tour.version || 0,
    cancelled: tour.cancelled === true, tasks: Object.values(tasks),
    previewKey: stableHash(JSON.stringify(tasks)), notificationEmail: tour.cancellation?.notificationEmail || ''};
}
function cancellationMessage(tour, tasks, email, late = false) {
  const heading = late ? 'Payment received after tour cancellation' : 'Tour cancelled';
  const lines = Object.values(tasks).map(t => `${t.sponsorName}: ${t.amountCents == null ? 'Amount needs verification' : '$' + (t.amountCents / 100).toFixed(2)}\n${t.amountLabel}\nContact: ${t.email || t.phone || 'Not recorded'}\nPayment ID: ${t.paymentId || 'Not recorded'}\nCheckout reference: ${t.checkoutSessionId || 'Not recorded'}${t.paymentUrl ? '\nPayment lookup: ' + t.paymentUrl : ''}\nRefund status: pending`);
  const text = `${heading}: ${tour.name} (${tour.date})\n\nNo refund has been issued by MarketReady Tours. Review each payment, including any existing dispute, before taking action.\n\n${lines.length ? lines.join('\n\n') : 'No recorded paid sponsors at cancellation.'}\n\nOpen the app and select Cancelled tours to track and resolve these tasks:\nhttps://marketreadytours.com/app/`;
  return {to: email, subject: `${heading}: ${tour.name}`, text,
    html: `<h1>${escapeHtml(heading)}</h1><div style="white-space:pre-wrap">${escapeHtml(text)}</div>`};
}
module.exports = {refundTasks, cancellationPreview, cancellationMessage};
