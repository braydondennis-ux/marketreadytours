'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {refundTasks,cancellationPreview,cancellationMessage}=require('../lib/cancellation');
const {publicTourProjection}=require('../lib/domain');
const {planTourReminders}=require('../lib/reminders');
const tour={id:'tour',name:'<Tour>',date:'2027-01-01',sponsors:[{id:'sp',name:'<Sponsor>',paid:true,email:'sponsor@example.com'}]};
test('payment records supply amounts and references; manual payments stay unknown',()=>{
 assert.equal(Object.values(refundTasks(tour))[0].amountCents,null);
 const payments={session:{tourId:'tour',sponsorId:'sp',status:'paid',amountCents:4975,cloverPaymentId:'PAY123'},pending:{tourId:'tour',sponsorId:'sp',status:'pending'}};
 const tasks=Object.values(refundTasks(tour,payments));assert.equal(tasks.length,1);assert.equal(tasks[0].amountCents,4975);assert.equal(tasks[0].paymentId,'PAY123');
 assert.notEqual(cancellationPreview(tour,{}).previewKey,cancellationPreview(tour,payments).previewKey);
});
test('cancelled tours have no public projection or future reminders',()=>{
 const cancelled={...tour,cancelled:true};assert.equal(publicTourProjection(cancelled),null);assert.equal(planTourReminders({tour:cancelled,now:0}).size,0);
});
test('cancellation notices escape untrusted names and state refunds are pending',()=>{
 const message=cancellationMessage(tour,refundTasks(tour),'organizer@example.com');
 assert.equal(message.to,'organizer@example.com');assert.match(message.html,/&lt;Sponsor&gt;/);assert.doesNotMatch(message.html,/<Sponsor>/);assert.match(message.text,/No refund has been issued/);
});

test('Square partial collections require amount verification and keep invoice references',()=>{
 const squareTour={...tour,sponsors:[{id:'sp',signupId:'signup',paid:true}]};
 const tasks=Object.values(refundTasks(squareTour,{}, {inv:{tourId:'tour',signupId:'signup',status:'partially_paid',amountCents:9950}}));
 assert.equal(tasks.length,1);assert.equal(tasks[0].amountCents,null);assert.equal(tasks[0].paymentId,'inv');
});
