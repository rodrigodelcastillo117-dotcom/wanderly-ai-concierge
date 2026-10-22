# Correo de invitación Privé — cabeceras (redactadas) y DNS, 2026-10-22

        by mail.mailinator.com with SMTP (Mailinator)
        for <buzón sintético P>;
        Thu, 22 Oct 2026 06:58:23 +0000 (UTC)
DKIM-Signature: v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple; s=resend;
	d=traveliatos.life; t=1792652303;
	h=From:To:Subject:Message-ID:Date:MIME-Version:Content-Type;
	bh=/Xd0/LUxb22xxQKXi+WxBsm+WD4mA18gh0AuDrYA0ak=;
	b=<firma>
	<firma>
	<firma>
DKIM-Signature: v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple;
	s=224i4yxa5dv7c2xz3womw6peuasteono; d=amazonses.com; t=1792652303;
	h=From:To:Subject:Message-ID:Date:MIME-Version:Content-Type:Feedback-ID;
	bh=/Xd0/LUxb22xxQKXi+WxBsm+WD4mA18gh0AuDrYA0ak=;
	b=<firma>
	<firma>
	<firma>
From: IATOS AI <hola@traveliatos.life>
To: <buzón sintético P>
Subject: A private invitation awaits you.
Message-ID: <010001a162675c54-0511cab3-4037-41ad-90c5-5aa2094f241c-000000@email.amazonses.com>
Date: Thu, 22 Oct 2026 06:58:23 +0000
MIME-Version: 1.0
Content-Type: multipart/alternative;
 boundary="--_NmP-b8d8857b3988b3c7-Part_1"
Feedback-ID: <omitido>
X-SES-Outgoing: 2026.10.22-54.240.48.60

## SMTP (Mailinator SMTP_LOG)
EHLO a48-60.smtp-out.amazonses.com · STARTTLS · MAIL FROM:<…@rsend.traveliatos.life> · 250 Ok · Public Message Stored

## DNS (dns.google, 2026-10-22 ~07:05 UTC)
rsend.traveliatos.life TXT -> CNAME rsend.forge.rmta.net, 'v=spf1 include:amazonses.com ~all'
amazonses.com SPF incluye ip4:54.240.0.0/18 (contiene 54.240.48.60)
resend._domainkey.traveliatos.life TXT -> p=MIGfMA0GCSq… (llave publicada)
_dmarc.traveliatos.life TXT -> 'v=DMARC1; p=none;'

Mailinator no agrega Authentication-Results. Verificación criptográfica DKIM con dkimpy: 'body hash mismatch' porque la vista RAW de Mailinator altera el cuerpo (14 340 caracteres mostrados vs 15 889 bytes recibidos): NO concluyente.
