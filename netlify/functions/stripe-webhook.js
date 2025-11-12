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

    // Build email content
    const emailHtml = buildEmailHtml(session, lineItems);

    try {
      // Send email using Resend
      await resend.emails.send({
        from: 'Where Rooms Begin <onboarding@resend.dev>', // Update this to your verified domain
        to: session.customer_email,
        subject: 'Booking Confirmation',
        html: emailHtml,
      });

      console.log('Confirmation email sent to:', session.customer_email);

      // Optional: Send a copy to yourself
      await resend.emails.send({
        from: 'Where Rooms Begin <onboarding@resend.dev>',
        to: 'your-email@example.com', // Update with your business email
        subject: `New Booking from ${session.metadata.customer_name}`,
        html: emailHtml,
      });

    } catch (error) {
      console.error('Error sending email:', error);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
};

// Build minimal black and white HTML email template
function buildEmailHtml(session, lineItems) {
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
    
    // Simple check: if description contains common add-on keywords
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
                    <a href="#" style="color: #000; text-decoration: underline;">View measurement guide →</a>
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