using System;

namespace Unity.RenderStreaming
{
#pragma warning disable 0649
    [Serializable]
    public class DescData
    {
        public string connectionId;
        public string sdp;
        public string type;
        public bool polite;
        public AuthProfileData authProfile;
    }

    [Serializable]
    public class AuthProfileData
    {
        public string passcodeId;
        public string role;
        public string username;
        public string bodyType;
        public string modelTypeDto;
        public string characterDescription;
    }

    [Serializable]
    public class CandidateData
    {
        public string connectionId;
        public string candidate;
        public string sdpMid;
        public int sdpMLineIndex;
    }

    [Serializable]
    class SignalingMessage
    {
        public string status;
        public string message;
        public string sessionId;
        public string connectionId;
        public bool polite;
        public string sdp;
        public string type;
        public string candidate;
        public string sdpMid;
        public int sdpMLineIndex;
        public AuthProfileData authProfile;
    }

    [Serializable]
    class RoutedMessage<T>
    {
        public string from;
        public string to;
        public string type;
        public T data;
    }

    [Serializable]
    class OpenSessionData
    {
        public string sessionId;
    }

    [Serializable]
    class CreateConnectionResData
    {
        public string connectionId;
        public bool polite;
        public AuthProfileData authProfile;
    }

    [Serializable]
    class DestroyConnectionResData
    {
        public string connectionId;
    }

    [Serializable]
    class ConnectionResDataList
    {
        public DescData[] connections;
    }

    [Serializable]
    class OfferResDataList
    {
        public DescData[] offers;
    }

    [Serializable]
    class AnswerResDataList
    {
        public DescData[] answers;
    }


    [Serializable]
    class CandidateContainerResDataList
    {
        public CandidateContainerResData[] candidates;
    }

    [Serializable]
    class CandidateContainerResData
    {
        public string connectionId;
        public CandidateData[] candidates;
    }

    [Serializable]
    class AllResData
    {
        public SignalingMessage[] messages;
        public string datetime;
    }

#pragma warning restore 0649
}
