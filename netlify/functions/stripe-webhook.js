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
        from: 'Your Business <onboarding@resend.dev>', // Change this to your verified domain
        to: session.customer_email,
        subject: 'Booking Confirmation - Thank You!',
        html: emailHtml,
      });

      console.log('Confirmation email sent to:', session.customer_email);

      // Optional: Send a copy to yourself
      await resend.emails.send({
        from: 'Your Business <onboarding@resend.dev>',
        to: 'your-business-email@example.com', // Your email
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

// Build HTML email template
function buildEmailHtml(session, lineItems) {
  const metadata = session.metadata;
  
  // Build line items HTML
  let itemsHtml = '';
  lineItems.data.forEach(item => {
    const amount = (item.amount_total / 100).toFixed(2);
    itemsHtml += `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.description}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">£${amount}</td>
      </tr>
    `;
  });

  // Build discount HTML if applicable
  let discountHtml = '';
  if (parseFloat(metadata.total_discount) > 0) {
    discountHtml = `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #16a34a;"><strong>Total Savings</strong></td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; color: #16a34a;"><strong>-£${parseFloat(metadata.total_discount).toFixed(2)}</strong></td>
      </tr>
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
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Booking Confirmed! 🎉</h1>
      </div>
      
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
        
        <p style="font-size: 16px; margin-bottom: 20px;">
          Hi <strong>${metadata.customer_name}</strong>,
        </p>
        
        <p style="font-size: 16px; margin-bottom: 30px;">
          Thank you for your booking! Your payment has been successfully processed. Here are your booking details:
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #667eea; font-size: 20px;">Booking Details</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHtml}
            ${discountHtml}
            <tr>
              <td style="padding: 15px 10px 10px 10px;"><strong style="font-size: 18px;">Total Paid</strong></td>
              <td style="padding: 15px 10px 10px 10px; text-align: right;"><strong style="font-size: 18px; color: #667eea;">£${(session.amount_total / 100).toFixed(2)}</strong></td>
            </tr>
          </table>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #667eea; font-size: 20px;">Contact Information</h2>
          <p style="margin: 5px 0;"><strong>Name:</strong> ${metadata.customer_name}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${session.customer_email}</p>
          <p style="margin: 5px 0;"><strong>Phone:</strong> ${metadata.customer_phone}</p>
          ${metadata.voucher_code ? `<p style="margin: 5px 0;"><strong>Voucher Used:</strong> ${metadata.voucher_code}</p>` : ''}
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #667eea; font-size: 20px;">What's Next?</h2>
          <p style="margin: 5px 0;">✅ You'll receive further instructions via email within 24 hours</p>
          <p style="margin: 5px 0;">✅ Our team will contact you to schedule your consultation</p>
          <p style="margin: 5px 0;">✅ Keep this email for your records</p>
        </div>

        <p style="font-size: 16px; margin-top: 30px;">
          If you have any questions, please don't hesitate to contact us.
        </p>

        <p style="font-size: 16px; margin-bottom: 0;">
          Best regards,<br>
          <strong>Your Business Name</strong>
        </p>

      </div>

      <div style="text-align: center; margin-top: 30px; padding: 20px; color: #666; font-size: 12px;">
        <p>This is an automated confirmation email.</p>
        <p>Payment ID: ${session.id}</p>
      </div>

    </body>
    </html>
  `;
}