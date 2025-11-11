import express from "express";
import bodyParser from "body-parser";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import chalk from "chalk";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(bodyParser.json());

// ----------------------
// INICIALIZA WHATSAPP
// ----------------------
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

client.on("qr", (qr) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log(chalk.cyan("\n📱 Escaneie o QR code no navegador:"));
  console.log(chalk.yellow(qrUrl));
  console.log(chalk.gray("💚 Após escanear, aguarde alguns segundos até conectar..."));
});

client.on("ready", () => {
  console.log(chalk.green("✅ WhatsApp conectado e pronto!"));
});

client.initialize();

// ----------------------
// FILA DE MENSAGENS (anti-banimento)
// ----------------------
const messageQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;

  isProcessing = true;
  const { phone, message } = messageQueue.shift();

  try {
    const formatted = phone.replace(/\D/g, "");
    const numberId = await client.getNumberId(formatted);
    if (!numberId) {
      console.log(chalk.red(`⚠️ O número ${phone} não tem WhatsApp.`));
      isProcessing = false;
      return;
    }

    const chat = await client.getChatById(numberId._serialized);
    await chat.sendMessage(message);
    console.log(chalk.green(`✅ Mensagem enviada para ${phone}`));
  } catch (err) {
    console.error(chalk.red("❌ Erro ao enviar mensagem:"), err);
  }

  setTimeout(() => {
    isProcessing = false;
    processQueue();
  }, 5 * 60 * 1000); // 5 minutos entre mensagens
}

// ----------------------
// ENDPOINT /shopify (Webhook)
// ----------------------
app.post("/shopify", async (req, res) => {
  try {
    const data = req.body;

    console.log(chalk.yellow("\n🔔 NOVO WEBHOOK RECEBIDO ---------------------"));
    console.log(`🧾 Pedido: ${data.name}`);
    console.log(`💰 Status financeiro: ${data.financial_status}`);
    console.log(`💳 Método de pagamento: ${data.payment_gateway_names?.[0] || "não informado"}`);
    console.log(`👤 Cliente: ${data.customer?.first_name || "não informado"}`);

    const phone =
      data.billing_address?.phone ||
      data.shipping_address?.phone ||
      data.customer?.phone ||
      data.phone ||
      null;

    console.log(`📞 Telefone: ${phone || "não informado"}`);
    console.log("------------------------------------------------");

    // Verifica se é PIX (ou método ainda não definido)
    const isPix =
      !data.payment_gateway_names ||
      data.payment_gateway_names.length === 0 ||
      data.payment_gateway_names.includes("pix");

    if (!isPix) {
      console.log(chalk.gray(`⚠️ Pedido ${data.name} ignorado (não é PIX)`));
      return res.status(200).send("Ignorado - não é PIX");
    }

    if (data.financial_status !== "pending") {
      console.log(chalk.gray(`⚠️ Pedido ${data.name} ignorado (status: ${data.financial_status})`));
      return res.status(200).send("Ignorado - já pago ou cancelado");
    }

    if (!phone) {
      console.log(chalk.red(`❌ Pedido ${data.name} sem telefone — não foi possível enviar mensagem.`));
      return res.status(200).send("Sem telefone");
    }

    const nome = data.customer?.first_name || "cliente";
    const valor = data.total_price || "0.00";

    const message = `Eiii *${nome}*, obrigado pela sua compra, fico muito feliz em ter você como cliente *AquaFit Brasil* 🩷💚

Meu nome é *Carolina* e percebi que o pagamento via *Pix* não foi feito, você teve algum problema?

Caso prefira e ache mais fácil, você pode fazer o pix para nossa chave *CNPJ* no valor de *R$${valor}* do seu pedido e encaminhar o comprovante por aqui mesmo para que eu atualize no sistema.

*Chave Pix CNPJ:* 52757947000145  
*Quem receberá:* JVL NEGÓCIOS DIGITAIS LTDA (Razão social da AquaFit Brasil)

Caso tenha tido alguma dúvida em relação ao pedido estou à disposição 😉`;

    console.log(chalk.blue(`🕒 Aguardando 10 minutos antes de enviar mensagem para ${phone}...`));

    // Aguarda 10 minutos antes de verificar novamente o status e enviar
    setTimeout(async () => {
      try {
        // Aqui você poderia consultar novamente a API da Shopify
        // e verificar se o status do pedido mudou pra "paid" antes de enviar.

        // Exemplo simplificado:
        if (data.financial_status === "pending") {
          messageQueue.push({ phone, message });
          console.log(chalk.magenta(`💌 Mensagem de recuperação agendada para ${phone}`));
          processQueue();
        } else {
          console.log(chalk.gray(`✅ Pedido ${data.name} já foi pago — mensagem não enviada.`));
        }
      } catch (err) {
        console.error(chalk.red("❌ Erro no agendamento da mensagem:"), err);
      }
    }, 10 * 60 * 1000); // 10 minutos

    res.status(200).send("Verificação agendada para pedido PIX");
  } catch (err) {
    console.error(chalk.red("❌ Erro ao processar webhook:"), err);
    res.status(500).send("Erro interno");
  }
});

// ----------------------
// SERVIDOR LOCAL / RAILWAY
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.blue(`🌐 Servidor rodando na porta ${PORT}`));
});
