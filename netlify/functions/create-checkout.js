const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
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
          unit_amount: Math.round(roomData.totalPrice * 100),
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
          unit_amount: Math.round(addonData.price * 100),
        },
        quantity: 1,
      });
    });

    // Build session config
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
        multi_room_discount: totals.discount.toString(),
        voucher_discount: totals.voucherDiscount.toString(),
        total_discount: (totals.discount + totals.voucherDiscount).toString(),
        final_total: totals.finalTotal.toString(),
      },
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
    };

    // Combine all discounts into ONE coupon (Stripe limit)
    const totalDiscount = totals.discount + totals.voucherDiscount;
    
    if (totalDiscount > 0) {
      // Build discount description
      let discountDescription = '';
      if (totals.discount > 0 && voucher && totals.voucherDiscount > 0) {
        discountDescription = `Multi-room (15%) + Voucher ${voucher.code} (${voucher.amount}%)`;
      } else if (totals.discount > 0) {
        discountDescription = 'Multi-room discount (15%)';
      } else if (voucher && totals.voucherDiscount > 0) {
        discountDescription = `Voucher: ${voucher.code} (${voucher.amount}%)`;
      }

      const combinedCoupon = await stripe.coupons.create({
        amount_off: Math.round(totalDiscount * 100),
        currency: 'gbp',
        duration: 'once',
        name: discountDescription,
      });
      
      sessionConfig.discounts = [{ coupon: combinedCoupon.id }];
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
