const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify webhook signature
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Webhook signature verification failed' }),
    };
  }

  // Handle successful payment
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    console.log('Payment successful for:', session.customer_email);

    // Get line items from the session
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product']
    });

    // Build customer email content
    const customerEmailHtml = buildCustomerEmailHtml(session, lineItems);

    // Build admin email content
    const adminEmailHtml = buildAdminEmailHtml(session, lineItems);

    try {
      // Send confirmation email to customer
      await resend.emails.send({
        from: 'Where Rooms Begin <hello@whereroomsbegin.com>',
        to: session.customer_email,
        subject: 'Booking Confirmation',
        html: customerEmailHtml,
      });

      console.log('Confirmation email sent to customer:', session.customer_email);

      // Send notification to admins
      const adminEmails = ['matt@autara.studio', 'hello@whereroomsbegin.com'];
      
      await resend.emails.send({
        from: 'Where Rooms Begin <hello@whereroomsbegin.com>',
        to: adminEmails,
        subject: `New Order from ${session.metadata.customer_name} - £${(session.amount_total / 100).toFixed(2)}`,
        html: adminEmailHtml,
      });

      console.log('Admin notification sent to:', adminEmails.join(', '));

    } catch (error) {
      console.error('Error sending email:', error);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
};

// Build customer email HTML (existing template)
function buildCustomerEmailHtml(session, lineItems) {
  const metadata = session.metadata;
  
  // Separate rooms and add-ons
  const rooms = [];
  const addons = [];
  
  lineItems.data.forEach(item => {
    const amount = (item.amount_total / 100).toFixed(2);
    const itemHtml = `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">${item.description}</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; text-align: right;">£${amount}</td>
      </tr>
    `;
    
    if (item.description.toLowerCase().includes('sketch') || 
        item.description.toLowerCase().includes('track') || 
        item.description.toLowerCase().includes('swatch') ||
        item.description.toLowerCase().includes('addon') ||
        item.description.toLowerCase().includes('add-on')) {
      addons.push(itemHtml);
    } else {
      rooms.push(itemHtml);
    }
  });

  const roomsHtml = rooms.join('');
  const addonsHtml = addons.join('');

  // Build savings section
  let savingsHtml = '';
  const multiRoomDiscount = parseFloat(metadata.multi_room_discount || 0);
  const voucherDiscount = parseFloat(metadata.voucher_discount || 0);
  const totalDiscount = parseFloat(metadata.total_discount || 0);

  if (totalDiscount > 0) {
    let savingsRows = '';
    
    if (multiRoomDiscount > 0) {
      savingsRows += `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e5e5;">Multi-room discount (15%)</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e5e5; text-align: right;">-£${multiRoomDiscount.toFixed(2)}</td>
        </tr>
      `;
    }
    
    if (voucherDiscount > 0) {
      savingsRows += `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e5e5;">Voucher (${metadata.voucher_code})</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e5e5; text-align: right;">-£${voucherDiscount.toFixed(2)}</td>
        </tr>
      `;
    }

    savingsHtml = `
      <div style="margin: 40px 0;">
        <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; color: #000;">Savings</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${savingsRows}
          <tr>
            <td style="padding: 12px 0;">Total savings</td>
            <td style="padding: 12px 0; text-align: right;">-£${totalDiscount.toFixed(2)}</td>
          </tr>
        </table>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Booking Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff; color: #000000;">
      
      <table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; margin: 0 auto; padding: 60px 20px;">
        <tr>
          <td>
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 60px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">Booking Confirmed</h1>
            </div>

            <!-- Greeting -->
            <p style="margin: 0 0 40px 0; font-size: 16px; line-height: 1.6;">
              Hi ${metadata.customer_name},
            </p>
            
            <p style="margin: 0 0 40px 0; font-size: 16px; line-height: 1.6;">
              Thank you for your booking. Your payment has been successfully processed.
            </p>

            <!-- Rooms Section -->
            <div style="margin: 40px 0;">
              <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; color: #000;">Room Packages</h2>
              <table style="width: 100%; border-collapse: collapse;">
                ${roomsHtml}
              </table>
            </div>

            <!-- Add-ons Section -->
            ${addons.length > 0 ? `
            <div style="margin: 40px 0;">
              <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; color: #000;">Add-ons</h2>
              <table style="width: 100%; border-collapse: collapse;">
                ${addonsHtml}
              </table>
            </div>
            ` : ''}

            <!-- Savings Section -->
            ${savingsHtml}

            <!-- Total -->
            <div style="margin: 40px 0; padding: 20px 0; border-top: 2px solid #000; border-bottom: 2px solid #000;">
              <table style="width: 100%;">
                <tr>
                  <td style="font-size: 18px; letter-spacing: 1px;">Total paid</td>
                  <td style="text-align: right; font-size: 18px; letter-spacing: 1px;">£${(session.amount_total / 100).toFixed(2)}</td>
                </tr>
              </table>
            </div>

            <!-- Customer Details -->
            <div style="margin: 40px 0;">
              <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; color: #000;">Your Details</h2>
              <table style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0; width: 120px;">Name</td>
                  <td style="padding: 8px 0;">${metadata.customer_name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">Email</td>
                  <td style="padding: 8px 0;">${session.customer_email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">Phone</td>
                  <td style="padding: 8px 0;">${metadata.customer_phone}</td>
                </tr>
              </table>
            </div>

            <!-- What's Next Section -->
            <div style="margin: 60px 0 40px 0; padding: 40px; border: 1px solid #000;">
              <h2 style="margin: 0 0 30px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; text-align: center;">What's Next</h2>
              
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 20px 0; border-bottom: 1px solid #e5e5e5;">
                    <div style="font-size: 16px; margin-bottom: 8px;">1. Schedule a meeting with us</div>
                    <a href="https://calendly.com/" style="color: #000; text-decoration: underline;">Book your consultation →</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px 0;">
                    <div style="font-size: 16px; margin-bottom: 8px;">2. How to measure your room</div>
                    <a href="https://cdn.prod.website-files.com/68fb85ec75c72f4adb7abbd4/6920b82fa56fbee1fc06f973_Measuring%20Your%20Room.pdf" style="color: #000; text-decoration: underline;">View measurement guide →</a>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Footer -->
            <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid #e5e5e5; text-align: center; color: #666;">
              <p style="margin: 0 0 10px 0; font-size: 12px; line-height: 1.6;">
                This is an automated confirmation email.
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.6;">
                Payment ID: ${session.id}
              </p>
            </div>

          </td>
        </tr>
      </table>

    </body>
    </html>
  `;
}

// Build admin notification email HTML
function buildAdminEmailHtml(session, lineItems) {
  const metadata = session.metadata;
  
  // Get current date/time
  const orderDate = new Date(session.created * 1000).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Build all line items
  let itemsHtml = '';
  lineItems.data.forEach(item => {
    const amount = (item.amount_total / 100).toFixed(2);
    itemsHtml += `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">${item.description}</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; text-align: right;">£${amount}</td>
      </tr>
    `;
  });

  // Build discount info
  let discountHtml = '';
  const multiRoomDiscount = parseFloat(metadata.multi_room_discount || 0);
  const voucherDiscount = parseFloat(metadata.voucher_discount || 0);
  const totalDiscount = parseFloat(metadata.total_discount || 0);

  if (totalDiscount > 0) {
    let discountRows = '';
    
    if (multiRoomDiscount > 0) {
      discountRows += `
        <tr>
          <td style="padding: 8px 0;">Multi-room discount (15%)</td>
          <td style="padding: 8px 0; text-align: right;">-£${multiRoomDiscount.toFixed(2)}</td>
        </tr>
      `;
    }
    
    if (voucherDiscount > 0) {
      discountRows += `
        <tr>
          <td style="padding: 8px 0;">Voucher (${metadata.voucher_code})</td>
          <td style="padding: 8px 0; text-align: right;">-£${voucherDiscount.toFixed(2)}</td>
        </tr>
      `;
    }

    discountHtml = `
      <div style="margin: 30px 0;">
        <h2 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">Discounts Applied</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${discountRows}
        </table>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Order Notification</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff; color: #000000;">
      
      <table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; margin: 0 auto; padding: 60px 20px;">
        <tr>
          <td>
            
            <!-- Header -->
            <div style="margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #000;">
              <h1 style="margin: 0 0 10px 0; font-size: 24px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">New Order Received</h1>
              <p style="margin: 0; font-size: 14px; color: #666;">${orderDate}</p>
            </div>

            <!-- Order Summary Box -->
            <div style="background: #f5f5f5; padding: 30px; margin-bottom: 40px;">
              <table style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0; width: 150px;">Order Total</td>
                  <td style="padding: 8px 0; font-size: 24px;">£${(session.amount_total / 100).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">Payment Status</td>
                  <td style="padding: 8px 0; color: #16a34a;">✓ Paid</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">Payment ID</td>
                  <td style="padding: 8px 0; font-size: 12px; font-family: monospace;">${session.id}</td>
                </tr>
              </table>
            </div>

            <!-- Customer Information -->
            <div style="margin: 40px 0;">
              <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">Customer Details</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5; width: 150px;">Name</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">${metadata.customer_name}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">Email</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;"><a href="mailto:${session.customer_email}" style="color: #000; text-decoration: underline;">${session.customer_email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">Phone</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;"><a href="tel:${metadata.customer_phone}" style="color: #000; text-decoration: underline;">${metadata.customer_phone}</a></td>
                </tr>
              </table>
            </div>

            <!-- Order Items -->
            <div style="margin: 40px 0;">
              <h2 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">Order Items</h2>
              <table style="width: 100%; border-collapse: collapse;">
                ${itemsHtml}
                <tr>
                  <td style="padding: 12px 0;">Subtotal</td>
                  <td style="padding: 12px 0; text-align: right;">£${parseFloat(metadata.subtotal).toFixed(2)}</td>
                </tr>
              </table>
            </div>

            <!-- Discounts -->
            ${discountHtml}

            <!-- Final Total -->
            <div style="margin: 40px 0; padding: 20px 0; border-top: 2px solid #000;">
              <table style="width: 100%;">
                <tr>
                  <td style="font-size: 18px; letter-spacing: 1px;">Total Paid</td>
                  <td style="text-align: right; font-size: 24px; letter-spacing: 1px;">£${(session.amount_total / 100).toFixed(2)}</td>
                </tr>
              </table>
            </div>

            <!-- Action Required -->
            <div style="margin: 40px 0; padding: 30px; background: #000; color: #fff;">
              <h2 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase;">Action Required</h2>
              <p style="margin: 0; font-size: 14px; line-height: 1.6;">
                Please reach out to ${metadata.customer_name} to schedule their consultation and begin the design process.
              </p>
            </div>

            <!-- Quick Links -->
            <div style="margin: 40px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 15px 0; border-bottom: 1px solid #e5e5e5;">
                    <a href="https://dashboard.stripe.com/test/payments/${session.payment_intent}" style="color: #000; text-decoration: underline;">View in Stripe Dashboard →</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px 0;">
                    <a href="mailto:${session.customer_email}" style="color: #000; text-decoration: underline;">Email Customer →</a>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Footer -->
            <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid #e5e5e5; text-align: center; color: #666;">
              <p style="margin: 0; font-size: 12px;">
                This is an automated admin notification from Where Rooms Begin
              </p>
            </div>

          </td>
        </tr>
      </table>

    </body>
    </html>
  `;
}
