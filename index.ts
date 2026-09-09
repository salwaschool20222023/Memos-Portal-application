// Supabase Edge Function: send-push-notification
// تُستدعى تلقائياً عبر Database Webhook عند إضافة صف جديد في جدول documents
// وترسل تنبيه Push فوري لكل الأجهزة المشتركة، حتى لو كان التطبيق مغلقاً.

import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(
  "mailto:admin@salwa-portal.app",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// نفس تسميات الأقسام الظاهرة في الموقع، لعرضها داخل نص التنبيه
const CATEGORY_LABELS: Record<string, string> = {
  "circulars-ministerial": "تعميم وزاري",
  "circulars-internal": "تعميم داخلي",
  "bulletins-external": "نشرة خارجية",
  "bulletins-internal": "نشرة داخلية",
  "decisions-ministerial": "قرار وزاري",
  "decisions-internal": "قرار داخلي",
  "evaluation": "آليات",
  "plans": "خطط",
  "exams-short-p1": "اختبار قصير - الفصل الدراسي الأول",
  "exams-short-p2": "اختبار قصير - الفصل الدراسي الثاني",
  "exams-end-p1": "اختبار نهاية الفترة الدراسية الأولى",
  "exams-end-p2": "اختبار الفترة الدراسية الثانية",
  "class-schedules": "جدول فصل",
  "announcements": "إعلان",
  "admin-forms": "نموذج إداري",
};

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const record = payload.record; // الصف الجديد المُضاف في جدول documents

    if (!record || !record.category || !record.title) {
      return new Response("لا يوجد بيانات مستند صالحة", { status: 400 });
    }

    const categoryLabel = CATEGORY_LABELS[record.category] || record.category;

    const notificationPayload = JSON.stringify({
      title: `تمت إضافة ${categoryLabel} جديد`,
      body: record.title,
      url: "./index.html",
    });

    // جلب كل الأجهزة المشتركة في التنبيهات من قاعدة البيانات
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const subscriptions = await subsRes.json();

    let sent = 0;
    let removed = 0;

    await Promise.all(
      (subscriptions as any[]).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            notificationPayload
          );
          sent++;
        } catch (err: any) {
          // الاشتراك منتهي الصلاحية أو غير صالح (المستخدم أزال الإذن) → نحذفه من القاعدة
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`,
              {
                method: "DELETE",
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
              }
            );
            removed++;
          }
        }
      })
    );

    return new Response(JSON.stringify({ sent, removed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
