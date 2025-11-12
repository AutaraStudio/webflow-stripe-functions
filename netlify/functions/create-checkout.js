const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*', // In production, replace with your Webflow domain
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { cart, addons, totals, customer, voucher, successUrl, cancelUrl } = JSON.parse(event.body);

    console.log('Creating checkout session for:', customer.email);

    // Build line items for Stripe
    const lineItems = [];

    // Add room packages
    Object.keys(cart).forEach(roomName => {
      const roomData = cart[roomName];
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: roomData.quantity > 1 ? `${roomData.quantity} x ${roomName}` : roomName,
            description: 'Room Package',
          },
          unit_amount: Math.round(roomData.totalPrice * 100), // FIXED: Changed from unit_price to unit_amount
        },
        quantity: 1,
      });
    });

    // Add addons
    Object.keys(addons).forEach(addonName => {
      const addonData = addons[addonName];
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: addonName,
            description: 'Addon',
          },
          unit_amount: Math.round(addonData.price * 100), // FIXED: Changed from unit_price to unit_amount
        },
        quantity: 1,
      });
    });

    // Handle discounts
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: customer.email,
      metadata: {
        customer_name: customer.name,
        customer_phone: customer.phone,
        voucher_code: voucher ? voucher.code : '',
        subtotal: totals.subtotalBeforeDiscount.toString(),
        discount: totals.discount.toString(),
        voucher_discount: totals.voucherDiscount.toString(),
        final_total: totals.finalTotal.toString(),
      },
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
    };

    // Add discounts as coupons if there are any
    const discounts = [];
    
    if (totals.discount > 0) {
      const multiRoomCoupon = await stripe.coupons.create({
        amount_off: Math.round(totals.discount * 100),
        currency: 'gbp',
        duration: 'once',
        name: 'Multi-room discount (15%)',
      });
      discounts.push({ coupon: multiRoomCoupon.id });
    }

    if (voucher && totals.voucherDiscount > 0) {
      const voucherCoupon = await stripe.coupons.create({
        amount_off: Math.round(totals.voucherDiscount * 100),
        currency: 'gbp',
        duration: 'once',
        name: `Voucher: ${voucher.code} (${voucher.amount}%)`,
      });
      discounts.push({ coupon: voucherCoupon.id });
    }

    if (discounts.length > 0) {
      sessionConfig.discounts = discounts;
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('Checkout session created:', session.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        checkoutUrl: session.url,
        sessionId: session.id 
      }),
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        details: 'Failed to create checkout session'
      }),
    };
  }
};
