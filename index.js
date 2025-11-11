import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import chalk from "chalk";

const { Client, LocalAuth } = pkg;
const app = express();
app.use(bodyParser.json());

// ==============================
// CONFIGURAÇÃO DO WHATSAPP
// ==============================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./session",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--renderer-process-limit=1",
    ],
  },
});

// QR code controlado (a cada 2 minutos)
let lastQRTime = 0;
client.on("qr", (qr) => {
  const now = Date.now();
  if (now - lastQRTime < 120000) return;
  lastQRTime = now;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
    qr
  )}`;
  console.log(chalk.cyan("\n📱 Escaneie o QR code no navegador:"));
  console.log(chalk.yellow(qrUrl));
});

client.on("ready", () => {
  console.log(chalk.green("✅ WhatsApp conectado e pronto!"));
});

client.initialize();

// ==============================
// LÓGICA DE PEDIDOS E PAGAMENTOS
// ==============================
const pendingOrders = new Map(); // Armazena pedidos pendentes (aguardando 10 min)

// Função para enviar mensagem no WhatsApp
async function enviarMensagemPixNaoPago(phone, name, total) {
  try {
    const formatted = phone.replace(/\D/g, "");
    const numberId = await client.getNumberId(formatted);

    if (!numberId) {
      console.log(chalk.red(`⚠️ O número ${phone} não tem WhatsApp.`));
      return;
    }

    const chat = await client.getChatById(numberId._serialized);

    const message = `Eiii *${name}*, obrigado pela sua compra! 🩷💚  
Fico muito feliz em ter você como cliente da *AquaFit Brasil*! 💖  

Meu nome é *Carolina* e percebi que o pagamento via Pix ainda não foi feito. Você teve algum problema? 🤔  

Caso prefira, você pode fazer o Pix diretamente para nossa chave CNPJ no valor de *R$${total}*, e enviar o comprovante por aqui mesmo para que eu atualize no sistema.  

💸 *Chave Pix (CNPJ):* 52757947000145  
🏢 *Quem receberá:* JVL NEGÓCIOS DIGITAIS LTDA (Razão social da AquaFit Brasil)

Se ficou alguma dúvida sobre o pedido, estou à disposição 😉`;

    await chat.sendMessage(message);
    console.log(chalk.green(`✅ Mensagem enviada para ${phone}`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao enviar mensagem:"), err);
  }
}

// ==============================
// WEBHOOK: PEDIDO CRIADO (PENDING PIX)
// ==============================
app.post("/shopify", async (req, res) => {
  try {
    const data = req.body;
    const status = data.financial_status;
    const paymentMethod = data.gateway || data.payment_gateway_names?.[0];

    console.log(chalk.yellow("\n🔔 NOVO WEBHOOK RECEBIDO ---------------------"));
    console.log(`🧾 Pedido: ${data.name}`);
    console.log(`💰 Status financeiro: ${status}`);
    console.log(`💳 Método de pagamento: ${paymentMethod}`);
    console.log(`👤 Cliente: ${data.customer?.first_name || "não informado"}`);

    const phone =
      data.billing_address?.phone ||
      data.shipping_address?.phone ||
      data.customer?.phone ||
      null;

    console.log(`📞 Telefone: ${phone || "não informado"}`);
    console.log("------------------------------------------------");

    if (!phone) return res.status(200).send("Sem telefone");

    // Se for PIX e estiver pendente, agenda verificação
    if (
      status === "pending" &&
      paymentMethod &&
      paymentMethod.toLowerCase().includes("pix")
    ) {
      console.log(chalk.blue(`🕒 Pedido ${data.name} aguardando 10 minutos para verificar pagamento...`));

      const order = {
        id: data.id,
        name: data.name,
        customer: data.customer?.first_name || "cliente",
        phone,
        total: data.total_price || "0,00",
      };

      // Armazena o pedido
      pendingOrders.set(order.id, order);

      // Aguarda 10 minutos
      setTimeout(async () => {
        // Se o pagamento ainda não foi confirmado
        if (pendingOrders.has(order.id)) {
          console.log(chalk.yellow(`⏳ Pagamento do pedido ${order.name} ainda pendente após 10 minutos.`));
          await enviarMensagemPixNaoPago(order.phone, order.customer, order.total);
          pendingOrders.delete(order.id);
        }
      }, 10 * 60 * 1000); // 10 minutos
    }

    res.status(200).send("Webhook recebido com sucesso");
  } catch (err) {
    console.error(chalk.red("❌ Erro no webhook:"), err);
    res.status(500).send("Erro interno");
  }
});

// ==============================
// WEBHOOK: PAGAMENTO CONFIRMADO
// ==============================
app.post("/payment", async (req, res) => {
  try {
    const data = req.body;

    if (data.financial_status === "paid" && pendingOrders.has(data.id)) {
      console.log(chalk.green(`💚 Pagamento confirmado para o pedido ${data.name}.`));
      pendingOrders.delete(data.id);
    }

    res.status(200).send("Pagamento processado");
  } catch (err) {
    console.error(chalk.red("❌ Erro no webhook de pagamento:"), err);
    res.status(500).send("Erro interno");
  }
});

// ==============================
// INICIA SERVIDOR
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.blue(`🌐 Servidor rodando na porta ${PORT}`));
});
