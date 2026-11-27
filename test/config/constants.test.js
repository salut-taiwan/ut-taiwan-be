'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../config/constants');
const { presentFees } = require('../../presenters/feesPresenter');
const { presentSalutStatus } = require('../../presenters/salutPresenter');

test('every semester and missing semester have the same NTD 1700 fee',()=>{for(const semester of [1,2,9,null,undefined]){assert.equal(C.getSalutMembershipFee(semester).amount,1700);assert.equal(C.getSalutMembershipFee(semester).billing,'once_per_study');assert.equal(C.getSalutMembershipFee(semester).amount_idr,null);}});

test('approved contribution remains active across May, November and later study years',()=>{for(const date of ['2026-05-01','2026-11-01','2027-05-01','2030-11-01'])assert.equal(C.isSalutActive('2026-01-01',new Date(date)),true);assert.equal(C.nextSalutExpiry(),null);assert.equal(C.mostRecentExpiryBefore(),null);});

test('missing, invalid or future approvals never grant eligibility',()=>{for(const approval of [null,'invalid','2099-01-01'])assert.equal(C.isSalutActive(approval,new Date('2026-11-01')),false);});

test('fees do not quote QRIS/IDR or periodic renewal dates',()=>{const out=presentFees({salutMembership:{new:1700,returning:1700,billing:'once_per_study',renewalPolicy:{}},serviceFees:[],totalServiceFees:0});assert.equal(out.salutMembership.new_display_idr,null);assert.equal(out.salutMembership.returning_display_idr,null);assert.equal(out.salutMembership.renewalPolicy.next_renewal_date_display,null);assert.match(out.salutMembership.tier_combined_display,/sekali selama masa perkuliahan/);});

test('historical expired records stay marked for review',()=>{assert.equal(presentSalutStatus({salut_status:'expired',is_salut_active:false}).effective_status,'expired');});
