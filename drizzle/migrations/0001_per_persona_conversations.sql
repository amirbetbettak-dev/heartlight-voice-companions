CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_persona_idx ON public.conversations (user_id, persona_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations select" ON public.conversations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own conversations insert" ON public.conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own conversations update" ON public.conversations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own conversations delete" ON public.conversations FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.messages ADD COLUMN conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE;
CREATE INDEX messages_conversation_created_idx ON public.messages (conversation_id, created_at);

-- Backfill: existing messages become one conversation per user and persona.
INSERT INTO public.conversations (user_id, persona_id, title, created_at, updated_at)
SELECT user_id, persona_id, '', min(created_at), max(created_at) FROM public.messages GROUP BY user_id, persona_id;
UPDATE public.messages m SET conversation_id = c.id
FROM public.conversations c
WHERE c.user_id = m.user_id AND c.persona_id = m.persona_id AND m.conversation_id IS NULL;
UPDATE public.conversations c SET title = left(regexp_replace(sub.content, '\s+', ' ', 'g'), 60)
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, content
  FROM public.messages WHERE role = 'user' AND conversation_id IS NOT NULL
  ORDER BY conversation_id, created_at
) sub
WHERE sub.conversation_id = c.id;

DROP POLICY "own messages insert" ON public.messages;
CREATE POLICY "own messages insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id
  AND conversation_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid() AND c.persona_id = messages.persona_id
  )
);

CREATE OR REPLACE FUNCTION public.touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now(),
      title = CASE
        WHEN title = '' AND NEW.role = 'user' THEN left(regexp_replace(NEW.content, '\s+', ' ', 'g'), 60)
        ELSE title
      END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_touch_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();